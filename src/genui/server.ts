/**
 * GenUI dashboard server: ask box -> S2 parse -> picker -> validated ChartSpec -> panel.
 * Saves panels and draft actions to a JSON store (GENUI_STORE, default .genui/).
 * Works with the model down: with no FLOWIQ_PARSE_* config, or when the model
 * fails, S2 falls back to the deterministic parser.
 * Run: node --no-warnings src/genui/server.ts  (PORT, default 4317)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { askPanel } from './picker.ts';
import { parseConfigFromEnv } from '../agent/model-parse.ts';
import { loadPortfolioStore } from '../data/loader.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UI = path.join(ROOT, 'ui/genui');
const STORE_DIR = path.resolve(process.env.GENUI_STORE ?? path.join(ROOT, '.genui'));
const PANELS = path.join(STORE_DIR, 'panels.json'), ACTIONS = path.join(STORE_DIR, 'actions.json');
const store = loadPortfolioStore();
const parse = parseConfigFromEnv();

const readJson = <T>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch { return d; } };
const writeJson = (f: string, v: unknown) => { fs.mkdirSync(STORE_DIR, { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 2)); fs.renameSync(`${f}.tmp`, f); };
type DraftState = 'draft' | 'pending_approval' | 'approved' | 'rejected';
interface DraftAction { id: string; action_type: string; target: { label: string; entity_id?: string }; question: string; state: DraftState; created_at: string; updated_at?: string; draft_text: string; cites: Array<{ label: string; value: number; unit: string; source: { template_id: string; template: string; field: string } }>; prev_state?: DraftState }
/** ISO 8601 with the box's own offset (UTC-6 for Manu). */
const localIso = (d = new Date()) => { const o = -d.getTimezoneOffset(), a = Math.abs(o); return new Date(d.getTime() + o * 6e4).toISOString().slice(0, 19) + (o >= 0 ? '+' : '-') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); };
const body = (req: http.IncomingMessage) => new Promise<any>((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const send = (res: http.ServerResponse, code: number, v: unknown, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(v) : v as Buffer); };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (req.method === 'POST' && url.pathname === '/api/ask') {
        const { question } = await body(req);
        if (typeof question !== 'string' || !question.trim() || question.length > 2000) return send(res, 400, { error: 'question required' });
        const p = await askPanel(question.trim(), store, parse);
        const modelDown = !!parse && p.parsePath === 'deterministic';
        return send(res, 200, { id: randomUUID(), created_at: new Date().toISOString(), question: p.question, spec: p.spec, errors: p.errors, parse_path: p.parsePath ?? 'deterministic', model_down: modelDown, model_note: modelDown ? (p.parseFallbackReason ?? 'model unavailable') : null });
      }
      if (url.pathname === '/api/panels' && req.method === 'GET') return send(res, 200, readJson(PANELS, []));
      if (url.pathname === '/api/panels' && req.method === 'POST') {
        const p = await body(req); if (!p?.id || !p?.spec) return send(res, 400, { error: 'panel required' });
        const all = readJson<any[]>(PANELS, []).filter((x) => x.id !== p.id); all.unshift(p); writeJson(PANELS, all.slice(0, 200)); return send(res, 200, { ok: true, count: Math.min(all.length, 200) });
      }
      if (url.pathname.startsWith('/api/panels/') && req.method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.slice(12)); writeJson(PANELS, readJson<any[]>(PANELS, []).filter((x) => x.id !== id)); return send(res, 200, { ok: true });
      }
      // Action Center: draft records only. Nothing is sent or executed; role claims in payloads are ignored.
      if (url.pathname === '/api/actions' && req.method === 'POST') {
        const a = await body(req);
        const all = readJson<DraftAction[]>(ACTIONS, []);
        const panel = readJson<any[]>(PANELS, []).find((x) => x.id === a.panel_id);
        if (!panel || panel.spec?.template !== 'recommendation_card') return send(res, 400, { error: 'a draft comes only from a saved recommendation panel' });
        const pr = panel.spec.props;
        const draft: DraftAction = {
          id: `D-${String(all.length + 1).padStart(4, '0')}`, action_type: panel.spec.intent.split('.')[1] ?? 'recommendation', target: { label: pr.title },
          question: panel.question, state: 'pending_approval', created_at: localIso(),
          draft_text: [pr.title, pr.summary, ...pr.reasoning].join('\n'),
          cites: pr.impacts.map((im: any, k: number) => ({ label: im.label, value: im.value.v, unit: im.unit === '$' ? '$' : im.unit === '%' ? '%' : 'count', source: { template_id: panel.id, template: 'recommendation_card', field: `props.impacts[${k}].value` } })),
        };
        all.unshift(draft); writeJson(ACTIONS, all); return send(res, 200, draft);
      }
      if (url.pathname === '/api/action-center' && req.method === 'GET') {
        const drafts = readJson<DraftAction[]>(ACTIONS, []);
        return send(res, 200, { template: 'action_center', state: drafts.length ? 'ready' : 'empty', drafts, filter: 'all' });
      }
      const m = url.pathname.match(/^\/api\/actions\/(D-\d{4})\/intent$/);
      if (m && req.method === 'POST') {
        const it = await body(req);
        const all = readJson<DraftAction[]>(ACTIONS, []); const d = all.find((x) => x.id === m[1]);
        if (!d) return send(res, 404, { error: 'no such draft' });
        if (it.kind === 'set_state' && (it.to === 'approved' || it.to === 'rejected') && (d.state === 'draft' || d.state === 'pending_approval')) { d.prev_state = d.state; d.state = it.to; }
        else if (it.kind === 'undo' && d.prev_state) { d.state = d.prev_state; delete d.prev_state; }
        else return send(res, 409, { error: 'state change not allowed', state: d.state });
        d.updated_at = localIso(); writeJson(ACTIONS, all); return send(res, 200, d);
      }
      if (req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const f = path.resolve(UI, rel);
        if (!f.startsWith(UI + path.sep) || !fs.existsSync(f)) return send(res, 404, { error: 'not found' });
        return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] ?? 'application/octet-stream');
      }
      send(res, 405, { error: 'method' });
    } catch (e) {
      send(res, 500, { error: 'data_error', detail: String((e as Error).message ?? e).slice(0, 300) });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4317);
  createServer().listen(port, '127.0.0.1', () => console.log(`FlowIQ GenUI on http://127.0.0.1:${port} (parse: ${parse ? 'model with deterministic fallback' : 'deterministic'}; store: ${STORE_DIR})`));
}
