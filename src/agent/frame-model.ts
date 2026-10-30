/**
 * Operadic question decomposition for the L2 (fair-housing) layer.
 *
 * A user question is not classified in one open-ended step. It is broken into
 * a fixed tree of small typed sub-questions, each a yes/no or a closed enum,
 * answered in one fast model call and validated against this schema:
 *
 *   group      Which protected group, if any, does it single out?    enum
 *   treatment  Does it ask to treat people differently?             yes/no
 *
 * They compose by a fixed rule: refuse = group != none AND treatment. The
 * model only ever tightens the deterministic layer (it can add a refusal,
 * never an answer), and any timeout, HTTP error or off-schema reply falls
 * back to the deterministic path alone.
 *
 * L1 stays deterministic. Asked which narrowing words have no column, or how
 * many statuses a question combines, the model marked studios, bathrooms
 * and sq ft as out of grammar (2 to 5 of 32 false "I don't know") and added
 * nothing over the closed grammar in intent.ts, so those sub-questions
 * were removed.
 *
 * Off unless FLOWIQ_FRAME_MODEL is set (for example
 * "openrouter:google/gemini-2.5-flash-lite") and OPENROUTER_API_KEY exists.
 */

export const PROTECTED_GROUPS = [
  'none', 'race_or_color', 'national_origin', 'religion', 'sex_or_gender', 'familial_status',
  'disability', 'age', 'marital_status', 'source_of_income', 'military_status', 'other_protected',
] as const;
export type ProtectedGroup = (typeof PROTECTED_GROUPS)[number];

export interface FrameAnswers {
  readonly group: ProtectedGroup;
  readonly treatment: boolean;
}

export interface FrameVerdict {
  readonly refuse: boolean;
  readonly answers: FrameAnswers | null;
  readonly fallbackReason: string | null;
}

const SYSTEM = `You classify one request sent to a multifamily portfolio analytics tool. Answer two sub-questions and reply with JSON only:
{"group": one of ${JSON.stringify(PROTECTED_GROUPS)}, "treatment": boolean}
group: the protected group (US Fair Housing Act or Illinois Human Rights Act) the request singles out, in any language or encoding; "none" if no group of people is singled out. A building feature (an elevator, accessible units) is not singling out.
treatment: true if the request asks to treat, screen, price, steer, market to, delay, mislead or describe people differently because of that group; false for a plain data question or inclusive wording.`;

export function frameModelConfig(env: Readonly<Record<string, string | undefined>> = process.env): { model: string; key: string } | null {
  const spec = env.FLOWIQ_FRAME_MODEL;
  const key = env.OPENROUTER_API_KEY;
  if (!spec || !key) return null;
  const model = spec.replace(/^openrouter:/, '');
  return { model, key };
}

/** Strict schema check: an off-schema reply is no reply. */
export function parseFrameAnswers(raw: unknown): FrameAnswers | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (keys !== 'group,treatment') return null;
  if (!PROTECTED_GROUPS.includes(o.group as ProtectedGroup)) return null;
  if (typeof o.treatment !== 'boolean') return null;
  return { group: o.group as ProtectedGroup, treatment: o.treatment };
}

/** The operad's composition: a fixed rule over the typed answers. */
export const composeFrame = (a: FrameAnswers): boolean => a.group !== 'none' && a.treatment;

/**
 * After a 429 the model is not called again until OpenRouter's Retry-After
 * (or 60 s) has passed, so a rate limit never turns into a retry storm.
 */
let pausedUntil = 0;

export async function classifyFrame(question: string, timeoutMs = 8000): Promise<FrameVerdict> {
  const cfg = frameModelConfig();
  const off = (why: string): FrameVerdict => {
    const fallbackReason = `${why}; L2 ran on the deterministic grammar only`;
    if (cfg) console.error(`[flowiq] frame model fallback: ${fallbackReason}`);
    return { refuse: false, answers: null, fallbackReason };
  };
  if (!cfg) {
    // Asked for a model but given no key: say so rather than fall back silently.
    if (process.env.FLOWIQ_FRAME_MODEL && !process.env.OPENROUTER_API_KEY) {
      const fallbackReason = 'FLOWIQ_FRAME_MODEL is set but OPENROUTER_API_KEY is not; L2 ran on the deterministic grammar only';
      console.error(`[flowiq] frame model fallback: ${fallbackReason}`);
      return { refuse: false, answers: null, fallbackReason };
    }
    return { refuse: false, answers: null, fallbackReason: null };
  }
  if (Date.now() < pausedUntil) {
    return off(`frame model rate-limited (HTTP 429), not called again until ${new Date(pausedUntil).toISOString()}`);
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: question }],
      }),
    });
    if (res.status === 429) {
      // Retry-After is seconds; 1e400 is Infinity and -5 is no wait, so it is
      // clamped to 1 s .. 1 h (a non-number means 60 s).
      const raw = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(raw) ? Math.min(3600, Math.max(1, Math.ceil(raw))) : raw === Infinity ? 3600 : 60;
      pausedUntil = Date.now() + wait * 1000;
      return off(`frame model rate-limited by OpenRouter (HTTP 429), not retried for ${wait} s`);
    }
    if (!res.ok) return off(`frame model HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    let json: unknown;
    try { json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return off('frame model reply is not JSON'); }
    const answers = parseFrameAnswers(json);
    if (!answers) return off('frame model reply is off-schema');
    return { refuse: composeFrame(answers), answers, fallbackReason: null };
  } catch (err) {
    return off(`frame model unavailable: ${(err as Error).name}`);
  }
}
