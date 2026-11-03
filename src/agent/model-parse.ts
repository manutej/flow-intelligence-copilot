import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATE_WINDOWS, type DateWindowSpec } from '../config/rules.ts';
import type { PortfolioStore } from '../data/schema.ts';
import { unknownWords } from '../domain/vocabulary.ts';
import { unboundNegators } from './closed-world.ts';
import { parseExplicitDateWindow, parseQueryIntent, type ParsedQueryIntent } from './intent.ts';
import { RunStore, normalizeQuestion, runKey, sha256 } from './run-store.ts';
import { hashOf } from './envelope.ts';
import { AGGREGATION_SET, DOMAIN_SET, MEASURES, typedQueryErrors } from './typed-query.ts';

/**
 * S2-L1: the model proposes a TypedQuery, code decides. The parser calls an
 * OpenAI-compatible chat endpoint under the FlowIQ GBNF (llama-server
 * `grammar`) or a JSON schema (Ollama `response_format`), strips `kind`,
 * validates against the closed lists, and runs the coverage check. Off unless
 * FLOWIQ_PARSE_URL is set; any failure falls back to the deterministic parser
 * and says so.
 */
export interface ParseConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly backend: 'llama' | 'ollama';
  readonly quant: string;
  readonly grammarPath: string;
  readonly cache: boolean;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GRAMMAR = path.resolve(HERE, '../../grammar/flowiq-typedquery.gbnf');

export function parseConfigFromEnv(env: Record<string, string | undefined> = process.env): ParseConfig | null {
  if (!env.FLOWIQ_PARSE_URL) return null;
  return {
    baseUrl: env.FLOWIQ_PARSE_URL.replace(/\/+$/, ''),
    model: env.FLOWIQ_PARSE_MODEL ?? 'local',
    timeoutMs: Number(env.FLOWIQ_PARSE_TIMEOUT_MS ?? 30000),
    backend: env.FLOWIQ_PARSE_BACKEND === 'ollama' ? 'ollama' : 'llama',
    quant: env.FLOWIQ_PARSE_QUANT ?? 'unknown',
    grammarPath: env.FLOWIQ_PARSE_GRAMMAR ?? DEFAULT_GRAMMAR,
    cache: env.FLOWIQ_PARSE_NO_CACHE !== '1',
  };
}

const DATE_KEYS = [...Object.keys(DATE_WINDOWS), 'MON_YYYY (e.g. DEC_2026)', 'YEAR_YYYY'];
export const SYSTEM_PROMPT = [
  'You translate one question about a multifamily rental portfolio into exactly one JSON object.',
  'Shapes: {"kind":"query","question":<the question>,"intent":{...}} | {"kind":"clarify","options":[2-4 strings]} | {"kind":"draft","request":<text>}.',
  'intent keys, in this order: domain, measure, aggregation, isWholePortfolioExplicit, isClassComparison, dateWindow, dateExplicit, mentionedSources, paidOnly, decisionIds, then only the optional filters the question states: topK, buildingClass, yearBuiltMin, yearBuiltMax, bedrooms, bathrooms, rentMin, rentMax, bedroomsMin, bedroomsMax, bathroomsMin, bathroomsMax, sqftMin, sqftMax, floorMin, floorMax, view, unitStatus, unitStatusIn, leaseType, renewalStatus, leaseStartWindow, leaseEndWindow, decisionAccepted, decisionDirection.',
  `domain: ${[...DOMAIN_SET].join(', ')}. aggregation: ${[...AGGREGATION_SET].join(', ')}.`,
  `measure: ${[...MEASURES].join(', ')}.`,
  `dateWindow keys: ${DATE_KEYS.join(', ')}. Use APR_SEP_2026 with dateExplicit false when no date is named.`,
  'Bounds are inclusive: "at least 2" is min 2, "more than 2" is min 3 for whole numbers, "between 4 and 7" is min 4 max 7.',
  'Set a filter only when the question states it. If any part of the question cannot be expressed with these fields, emit clarify, never a query that drops it.',
  'unitStatusIn is two statuses, sorted, e.g. ["notice","occupied"]; use it only when the question names both statuses.',
  'There are no fields about people or protected classes. Requests to write listings or messages are draft.',
].join('\n');

export interface ModelParse {
  readonly path: 'model' | 'model-clarify' | 'deterministic';
  readonly intent: ParsedQueryIntent;
  readonly deterministic: ParsedQueryIntent;
  readonly raw: string | null;
  readonly coverage: { readonly ok: boolean; readonly unbound: readonly string[]; readonly fields_bound: readonly string[] };
  readonly fallbackReason: string | null;
  readonly latencyMs: number;
  readonly cacheHit: boolean;
  readonly runKey: string | null;
  /** What the endpoint returned, for the run log (null when no call was made). */
  readonly call?: ModelCall | null;
}

export interface ModelCall {
  readonly finish_reason: string | null;
  readonly completion_tokens: number | null;
  readonly reasoning_chars: number;
  readonly max_tokens: number;
  readonly raw_head: string;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const FILTERS = ['topK', 'buildingClass', 'yearBuiltMin', 'yearBuiltMax', 'bedrooms', 'bathrooms', 'rentMin', 'rentMax', 'bedroomsMin', 'bedroomsMax', 'bathroomsMin', 'bathroomsMax', 'sqftMin', 'sqftMax', 'floorMin', 'floorMax', 'view', 'unitStatus', 'unitStatusIn', 'leaseType', 'renewalStatus', 'decisionAccepted', 'decisionDirection'] as const;

function windowOf(key: unknown): DateWindowSpec | null {
  if (typeof key !== 'string') return null;
  if (DATE_WINDOWS[key]) return DATE_WINDOWS[key];
  const m = key.match(/^([A-Z]{3})_(20\d{2})$/);
  if (m) return parseExplicitDateWindow(`${m[1].toLowerCase()} ${m[2]}`);
  const y = key.match(/^YEAR_(20\d{2})$/);
  return y ? parseExplicitDateWindow(`in ${y[1]}`) : null;
}

/** A model object to a ParsedQueryIntent, or the reason it is not one. */
export function toIntent(obj: unknown): ParsedQueryIntent | string {
  if (!obj || typeof obj !== 'object') return 'not an object';
  const o = obj as Record<string, unknown>;
  if (o.kind !== 'query') return `kind=${String(o.kind)}`;
  const i = o.intent as Record<string, unknown> | undefined;
  if (!i || typeof i !== 'object') return 'no intent';
  if (!DOMAIN_SET.has(String(i.domain)) || !MEASURES.has(String(i.measure)) || !AGGREGATION_SET.has(String(i.aggregation))) return 'domain/measure/aggregation not in the closed lists';
  const allowed = new Set(['domain', 'measure', 'aggregation', 'isWholePortfolioExplicit', 'isClassComparison', 'dateWindow', 'dateExplicit', 'mentionedSources', 'paidOnly', 'decisionIds', 'leaseStartWindow', 'leaseEndWindow', ...FILTERS]);
  const extra = Object.keys(i).filter((k) => !allowed.has(k));
  if (extra.length) return `unknown fields: ${extra.join(', ')}`;
  const dw = windowOf(i.dateWindow);
  if (!dw) return `dateWindow ${String(i.dateWindow)} is not a known window`;
  const out: Record<string, unknown> = { ...i, dateWindow: dw, mentionedSources: i.mentionedSources ?? [], decisionIds: i.decisionIds ?? [] };
  for (const k of ['leaseStartWindow', 'leaseEndWindow']) {
    if (i[k] === undefined) continue;
    const w = windowOf(i[k]);
    if (!w) return `${k} is not a known window`;
    out[k] = w;
  }
  const intent = out as unknown as ParsedQueryIntent;
  const errs = typedQueryErrors(intent);
  return errs.length ? errs.join('; ') : intent;
}

/**
 * Coverage: every content word has a meaning FlowIQ reads, and the model's
 * TypedQuery equals the lexicon reading in every field: domain, measure,
 * aggregation, period, scope, sources and every filter. The model never
 * picks the computation on its own; any field that differs, is dropped or
 * is unstated is unbound, so the turn clarifies instead of answering.
 */
export function coverage(question: string, intent: ParsedQueryIntent, det: ParsedQueryIntent, store: PortfolioStore) {
  const unbound = [...unknownWords(question, store), ...(intent.domain === 'units' ? unboundNegators(question) : [])];
  const fields_bound: string[] = [];
  const m0 = intent as unknown as Record<string, unknown>, d0 = det as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(d0), ...Object.keys(m0)])].sort();
  for (const k of keys) {
    const m = m0[k], d = d0[k];
    if (m === undefined && d === undefined) continue;
    if (hashOf(m ?? null) === hashOf(d ?? null)) fields_bound.push(k);
    else unbound.push(`${k}:${m === undefined ? 'dropped' : d === undefined ? 'unstated' : 'differs'}`);
  }
  return { ok: unbound.length === 0, unbound, fields_bound };
}

let storePromise: Promise<RunStore> | null = null;

export async function modelParse(
  question: string,
  store: PortfolioStore,
  cfg: ParseConfig | null = parseConfigFromEnv(),
  deps: { readonly fetch?: Fetch; readonly runStore?: RunStore | null } = {},
): Promise<ModelParse> {
  const det = parseQueryIntent(question, store);
  let call: ModelCall | null = null;
  const fallback = (reason: string, raw: string | null = null, latencyMs = 0, key: string | null = null): ModelParse => ({
    path: 'deterministic', intent: det, deterministic: det, raw, coverage: { ok: true, unbound: [], fields_bound: [] }, fallbackReason: reason, latencyMs, cacheHit: false, runKey: key, call,
  });
  if (!cfg) return fallback('model parse off (FLOWIQ_PARSE_URL unset)');
  let grammar: string;
  try {
    grammar = fs.readFileSync(cfg.grammarPath, 'utf8');
  } catch {
    return fallback(`grammar not found at ${cfg.grammarPath}`);
  }
  const params = { temperature: 0, max_tokens: 768, backend: cfg.backend };
  const key = runKey({ question, model: cfg.model, quant: cfg.quant, grammarSha: sha256(grammar), promptSha: sha256(SYSTEM_PROMPT), params });
  const runs = deps.runStore === undefined ? (cfg.cache ? await (storePromise ??= RunStore.open()) : null) : deps.runStore;

  let raw: string | null = null;
  let latencyMs = 0;
  let cacheHit = false;
  const hit = cfg.cache ? runs?.lookup(key) : null;
  if (hit && typeof hit.raw_output === 'string' && hit.raw_output.trim()) {
    raw = hit.raw_output;
    cacheHit = true;
  } else {
    const t0 = performance.now();
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: question }],
      temperature: 0,
      max_tokens: params.max_tokens,
      stream: false,
    };
    if (cfg.backend === 'llama') {
      // llama-server applies `grammar` on /v1/chat/completions, but a thinking
      // chat template opens with <think>, which the grammar forbids, and with
      // --reasoning-format auto the server moves the text into
      // reasoning_content, leaving content "". Turn thinking off so the
      // grammar constrains the whole reply.
      body.grammar = grammar;
      body.chat_template_kwargs = { enable_thinking: false };
      body.reasoning_format = 'none';
    }
    else body.response_format = { type: 'json_schema', json_schema: { name: 'flowiq', schema: JSON_SCHEMA } };
    try {
      const f = deps.fetch ?? (globalThis.fetch as unknown as Fetch);
      const res = await f(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      latencyMs = Math.round(performance.now() - t0);
      if (!res.ok) return fallback(`model endpoint HTTP ${res.status}`, null, latencyMs, key);
      const j = (await res.json()) as { usage?: { completion_tokens?: number }; choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null } }> };
      const c = j.choices?.[0];
      const content = c?.message?.content ?? '';
      const reasoning = c?.message?.reasoning_content ?? '';
      // An empty content with reasoning_content still holds the object when
      // the server split it out; keep both so the log shows what came back.
      raw = content.trim() ? content : reasoning.trim() ? reasoning : null;
      call = { finish_reason: c?.finish_reason ?? null, completion_tokens: j.usage?.completion_tokens ?? null, reasoning_chars: reasoning.length, max_tokens: params.max_tokens, raw_head: (raw ?? content).slice(0, 160) };
      if (raw === null) {
        return fallback(`model returned empty content (finish_reason=${c?.finish_reason ?? 'none'}, reasoning_content ${reasoning.length} chars, choices ${j.choices?.length ?? 0})`, content, latencyMs, key);
      }
    } catch (e) {
      latencyMs = Math.round(performance.now() - t0);
      return fallback(`model unavailable: ${(e as Error).name === 'TimeoutError' ? `timeout after ${cfg.timeoutMs} ms` : (e as Error).message}`, null, latencyMs, key);
    }
  }
  if (raw === null) return fallback('model returned no content', null, latencyMs, key);
  // Reasoning models may think before the object; the object is the last {...}.
  let obj: unknown;
  try {
    obj = JSON.parse(raw.replace(/^[\s\S]*?(?=\{"kind")/, ''));
  } catch {
    return record({ ...fallback(`model output is not JSON (${raw.length} chars, head ${JSON.stringify(raw.slice(0, 160))})`, raw, latencyMs, key), cacheHit });
  }
  // A reply that opens with anything but the object (e.g. "<think>") cannot
  // come from the grammar: the server did not apply it. Say so in the log.
  const unconstrained = !/^\s*\{/.test(raw) ? ' (reply not grammar-constrained: server ignored the grammar)' : '';
  const kind = (obj as { kind?: unknown } | null)?.kind;
  if (kind === 'clarify' || kind === 'draft') {
    // A model clarify or draft goes to the deterministic path, which owns
    // clarify options (built by template) and drafts (L2): the model-off turn.
    return record({ ...fallback(`model declined (kind=${kind}); answered as with the model off${unconstrained}`, raw, latencyMs, key), cacheHit });
  }
  const intent = toIntent(obj);
  if (typeof intent === 'string') {
    return record({ ...fallback(`model output not a valid TypedQuery: ${intent}${unconstrained}`, raw, latencyMs, key), cacheHit });
  }
  const cov = coverage(question, intent, det, store);
  return record({ path: cov.ok ? 'model' : 'model-clarify', intent, deterministic: det, raw, coverage: cov, fallbackReason: null, latencyMs, cacheHit, runKey: key, call });

  function record(p: ModelParse): ModelParse {
    if (runs && !cacheHit) {
      runs.append({ type: 'parse', key, ts: new Date().toISOString(), question_norm: normalizeQuestion(question), model: cfg!.model, raw_output: raw, typed_query: p.path === 'deterministic' ? null : p.intent, coverage: p.coverage, path: p.path, latency_ms: latencyMs, fallback_reason: p.fallbackReason, call });
    }
    return p;
  }
}

const en = (s: Set<string>) => ({ enum: [...s] });
const JSON_SCHEMA = {
  type: 'object',
  properties: {
    kind: { enum: ['query', 'clarify', 'draft'] },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    request: { type: 'string' },
    intent: {
      type: 'object',
      properties: {
        domain: en(DOMAIN_SET), measure: en(MEASURES), aggregation: en(AGGREGATION_SET),
        isWholePortfolioExplicit: { type: 'boolean' }, isClassComparison: { type: 'boolean' },
        dateWindow: { type: 'string' }, dateExplicit: { type: 'boolean' },
        mentionedSources: { type: 'array', items: { type: 'string' } }, paidOnly: { type: 'boolean' },
        decisionIds: { type: 'array', items: { type: 'string' } },
        unitStatus: { enum: ['occupied', 'notice', 'vacant'] },
        unitStatusIn: { type: 'array', items: { enum: ['notice', 'occupied', 'vacant'] }, minItems: 2, maxItems: 2 },
        bedrooms: { type: 'integer' }, bathrooms: { type: 'number' },
        bedroomsMin: { type: 'integer' }, bedroomsMax: { type: 'integer' },
        sqftMin: { type: 'integer' }, sqftMax: { type: 'integer' },
        floorMin: { type: 'integer' }, floorMax: { type: 'integer' },
        rentMin: { type: 'number' }, rentMax: { type: 'number' },
      },
      required: ['domain', 'measure', 'aggregation', 'dateWindow'],
      additionalProperties: true,
    },
  },
  required: ['kind'],
};
