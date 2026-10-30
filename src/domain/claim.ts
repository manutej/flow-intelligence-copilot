import type { AnswerEnvelope, PortfolioStore } from '../data/schema.ts';

/**
 * The claim an answer makes is its `result`. These checks hold whatever the
 * producer was, so a hand-written envelope is held to the same contract:
 *
 * 1. The result has a closed schema: every key is known, and each kind of
 *    value has its type and range (a count is a non-negative integer, never
 *    a string; a percent is in [0, 100]; a rate or share is in [0, 1]).
 * 2. Every number the answer text states is a checked value: a result
 *    value, a date part, a store constant, a count of cited rows, the unit
 *    total of a property the answer names, or one arithmetic step (sum,
 *    difference, product, ratio, percent) from values already checked.
 *    A stated number nothing explains is a forged figure.
 */

type Kind = 'count' | 'percent' | 'fraction' | 'money' | 'signed_money' | 'size' | 'property' | 'properties' | 'string' | 'strings' | 'bool' | 'pairs';

const KEY_KINDS: ReadonlyArray<readonly [RegExp, Kind]> = [
  [/^(?:property_id)$/, 'property'],
  [/^(?:property_ids|candidates)$/, 'properties'],
  [/(?:^|_)percent$/, 'percent'],
  [/(?:^|_)(?:rate|share|ratio)$/, 'fraction'],
  [/^delta_usd$/, 'signed_money'],
  [/(?:^|_)usd$/, 'money'],
  [/^sqft$/, 'size'],
  [/^(?:count|leases|leads|tours|units|ending|renewed|void_rows|duplicate_leads|total_units|occupied_units|new_leases|renewal_leases|post_signed_leases|post_strict_signed_leases)$/, 'count'],
  [/^(?:source|reason|decided_by|decision_id)$/, 'string'],
  [/^(?:sources|decision_ids)$/, 'strings'],
  [/^(?:unknown|refused|clarification_needed|accepted|is_operating)$/, 'bool'],
  [/^pairs$/, 'pairs'],
];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function claimSchemaErrors(result: Readonly<Record<string, unknown>>, store: PortfolioStore): string[] {
  const errors: string[] = [];
  const propertyIds = new Set(store.properties.map((p) => p.propertyId));
  for (const [key, v] of Object.entries(result)) {
    const kind = KEY_KINDS.find(([re]) => re.test(key))?.[1];
    const bad = (why: string) => errors.push(`Result ${key}=${JSON.stringify(v)} ${why}`);
    switch (kind) {
      case undefined: bad('is not a claim this verifier knows'); break;
      case 'count': if (!isNum(v) || !Number.isInteger(v) || v < 0) bad('must be a non-negative integer'); break;
      case 'percent': if (!isNum(v) || v < 0 || v > 100) bad('must be a number in [0, 100]'); break;
      case 'fraction': if (!isNum(v) || v < 0 || v > 1) bad('must be a number in [0, 1]'); break;
      case 'money': if (!isNum(v) || v < 0) bad('must be a non-negative number'); break;
      case 'signed_money': if (!isNum(v)) bad('must be a number'); break;
      case 'size': if (!isNum(v) || v <= 0) bad('must be a positive number'); break;
      case 'property': if (typeof v !== 'string' || !propertyIds.has(v)) bad('must name a property in the store'); break;
      case 'properties': if (!Array.isArray(v) || !v.every((p) => propertyIds.has(p))) bad('must list properties in the store'); break;
      case 'string': if (typeof v !== 'string') bad('must be a string'); break;
      case 'strings': if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) bad('must be a list of strings'); break;
      case 'bool': if (typeof v !== 'boolean') bad('must be a boolean'); break;
      case 'pairs': if (!Array.isArray(v) || !v.every((p) => Array.isArray(p) && p.length === 2 && propertyIds.has(p[0]) && typeof p[1] === 'string')) bad('must list [property_id, source] pairs'); break;
    }
  }
  return errors;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  dozen: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Readonly<Record<string, number>> = { hundred: 100, thousand: 1000, million: 1e6 };
const NUMBER_WORD_RE = new RegExp(`\\b(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(SCALE)].join('|')})(?:[-\\s]+(?:and[-\\s]+)?(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(SCALE)].join('|')}))*\\b`, 'gi');

/** Spelled-out numbers become digits, so "ninety" is checked like "90". */
function wordsToDigits(text: string): string {
  return text.replace(NUMBER_WORD_RE, (m) => {
    let total = 0;
    let current = 0;
    for (const w of m.toLowerCase().split(/[-\s]+/)) {
      if (w === 'and') continue;
      if (w in SCALE) { current = Math.max(current, 1) * SCALE[w]; if (SCALE[w] >= 1000) { total += current; current = 0; } }
      else current += NUMBER_WORDS[w];
    }
    return String(total + current);
  });
}

const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RE = new RegExp(`\\b\\d{4}-\\d{2}(?:-\\d{2})?\\b|\\b(?:q[1-4]|h[12]|${MONTH})\\s+\\d{4}\\b|\\b(?:in|of|during|for|since|through|to)\\s+\\d{4}\\b(?!-\\d)`, 'gi');

/** Every script's digits read as ASCII digits: ９ and ٩ are 9 (F-041). */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810];
function asciiDigits(text: string): string {
  return text.normalize('NFKC').replace(/[^\x00-\x7f]/g, (c) => {
    const cp = c.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp < z + 10);
    return zero === undefined ? c : String(cp - zero);
  });
}

/** A date is only a date when it is a real day near the store's data. */
function isRealDate(m: string): boolean {
  const iso = m.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!iso) return true;
  const [y, mo, d] = [Number(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : 1];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2015 && y <= 2035 && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}

function plain(text: string): string {
  return wordsToDigits(asciiDigits(text))
    .replace(/\ba\s+12\b/g, '12')
    .replace(DATE_RE, (m) => (isRealDate(m) ? ' ' : m.replace(/-/g, ' ')))
    // A window length is a date part while it fits the data's span: two
    // years. "999 days" or "37 months" is a figure and is checked.
    .replace(/\b(\d+)\s+(days?|weeks?|months?|years?)\b/gi, (m, n, unit) =>
      Number(n) <= ({ d: 731, w: 104, m: 24, y: 2 } as Record<string, number>)[unit[0].toLowerCase()] ? ' ' : `${n} ${unit}`)
    .replace(/(\d),(?=\d{3})/g, '$1');
}

/** Scaled forms are figures too: 999k is 999000 and 1e3 is 1000. */
function numbersIn(text: string): number[] {
  return [...plain(text)
    .matchAll(/(?<![\p{L}\d._])-?\d+(?:\.\d+)?(?:e[+-]?\d+|k\b|m\b)?(?![\p{L}\d])/giu)].map((m) => {
      const t = m[0].toLowerCase();
      return t.endsWith('k') ? Number(t.slice(0, -1)) * 1e3 : t.endsWith('m') ? Number(t.slice(0, -1)) * 1e6 : Number(t);
    });
}

function numericLeaves(v: unknown, out: number[] = []): number[] {
  if (isNum(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numericLeaves(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numericLeaves(x, out));
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 1e-6);

export function unexplainedNumbers(envelope: AnswerEnvelope, store: PortfolioStore): number[] {
  const text = envelope.answer ?? '';
  const stated = numbersIn(text);
  const named = new Set([
    ...numericLeaves([]),
    ...((text.match(/\bP\d{2,3}\b/g) ?? [])),
    ...[envelope.result?.property_id, ...(Array.isArray(envelope.result?.property_ids) ? envelope.result.property_ids : [])].filter((p): p is string => typeof p === 'string'),
  ]);
  const citedByTable = new Map<string, number>();
  for (const c of envelope.citations ?? []) {
    const t = c.slice(0, c.indexOf(':'));
    citedByTable.set(t, (citedByTable.get(t) ?? 0) + 1);
  }
  const checked = [
    0, 1, 100,
    ...numericLeaves(envelope.result ?? {}),
    store.policy.cadToUsdRate, store.policy.priorLeasesAlpha0, store.policy.priorSpendUsdBeta0,
    ...citedByTable.values(),
    ...store.properties.filter((p) => named.has(p.propertyId)).flatMap((p) => [p.actualUnitCount, p.declaredUnits]),
  ];
  // Arithmetic runs over these core values only: the claim, the store
  // constants and the named buildings' sizes. Row amounts and bounded
  // counts are checked as stated figures but never combined, or their many
  // sums and products would explain any invented number.
  const core = numericLeaves(envelope.result ?? {});
  // Money on the cited rows themselves, one by one and in total.
  // Rows the text names by ID count as cited, like rows in the citation list.
  const textIds = [...text.matchAll(/\b([SLDU])(?:\d{4,5}|-P\d{2,3}-\d{3})\b/g)].map((m) => m[0]);
  const tableOf: Readonly<Record<string, string>> = { S: 'spend', L: 'leases', D: 'leads', U: 'units' };
  const cited = new Set<string>([...(envelope.citations ?? []), ...textIds.map((id) => `${tableOf[id[0]]}:${id}`)]);
  const rowMoney = [
    ...store.spend.filter((r) => cited.has(r.citationId)).flatMap((r) => [r.effectiveUsd, r.rawAmount]),
    ...store.leases.filter((r) => cited.has(r.citationId)).map((r) => r.monthlyRent),
    ...store.units.filter((r) => cited.has(r.citationId)).map((r) => r.marketRent),
  ];
  const rowMoneyChecked = [...rowMoney, rowMoney.reduce((a, b) => a + b, 0)];
  // "N leases", "N matching units", "of which N toured": a count of rows is
  // checked when it fits inside that table for the properties in scope.
  const sizes = new Map<string, number>();
  const scope = store.properties.filter((p) => named.size === 0 || named.has(p.propertyId)).map((p) => p.propertyId);
  for (const [cit, owner] of store.primaryKeyIndex) {
    if (!scope.includes(owner)) continue;
    const t = cit.slice(0, cit.indexOf(':'));
    sizes.set(t, (sizes.get(t) ?? 0) + 1);
  }
  const ROW_NOUNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^(?:\w+\s+){0,2}?(?:units?|apartments?)\b|^(?:vacant|occupied|on\s+notice)\b/i, 'units'],
    [/^(?:\w+\s+){0,2}?(?:leases?|lease\s+starts|renewals?)\b|^(?:\w+\s+){0,1}?signed\b|^renewed\b|^have\s+renewed\b/i, 'leases'],
    [/^(?:\w+\s+){0,2}?(?:leads?|tours?)\b|^toured\b|^applied\b/i, 'leads'],
    [/^(?:\w+\s+){0,2}?(?:rows?|invoices?)\b|^(?:[\w-]+\s+){0,3}?\(?(?:property|building),\s+source\)?\s+pairs\b/i, 'spend'],
    [/^(?:pending|with\s+notice)\b/i, 'leases'],
  ];
  const text2 = plain(text);
  for (const m of text2.matchAll(/(?<![\p{L}\d._])(\d+)(?![\d.%])\s*(?:(?:of\s+them|of\s+which)\s+)?(?=(.{0,40}))/gu)) {
    const n = Number(m[1]);
    const before = text2.slice(Math.max(0, m.index - 60), m.index);
    const table = ROW_NOUNS.find(([re]) => re.test(m[2]))?.[1]
      ?? (/\b(?:with|at)\s*$/.test(before) && /\bunits?\b/.test(before) ? 'units' : undefined);
    if (table && n <= (sizes.get(table) ?? 0)) checked.push(n);
  }
  for (const m of text2.matchAll(/\bof\s+which\s+(\d+)|,\s+(\d+)\s+(?:toured|signed|have\s+renewed)|\bnotice=(\d+)/g)) {
    const n = Number(m[1] ?? m[2] ?? m[3]);
    if (n <= Math.max(0, ...sizes.values())) checked.push(n);
  }
  // A breakdown names each building: "Fulton Yards [P03]: 8".
  for (const m of text2.matchAll(/\[(P\d{2,3})\]:\s*(\d+)(?![\d.%])/g)) {
    const n = Number(m[2]);
    const own = [...store.primaryKeyIndex.values()].filter((o) => o === m[1]).length;
    if (n <= own) checked.push(n);
  }
  // A part and whole beside the percent they make: "5.8% (7/120)",
  // "94.8% (92 of 97 units)". The whole must fit in a table in scope.
  const largest = Math.max(0, ...sizes.values());
  for (const m of text2.matchAll(/(\d+(?:\.\d+)?)%\s*\(?\s*(\d+)\s*(?:\/|\s+of\s+)\s*(\d+)/g)) {
    const [p, a, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (b > 0 && a <= b && b <= largest && Math.abs((100 * a) / b - p) <= 0.051) checked.push(p, a, b);
  }
  // A dollar figure is bounded, not proven (the F7 limit): it must fit
  // inside the money the store holds for the properties in scope.
  const inScope = (pid: string) => scope.includes(pid);
  const moneyCeiling = Math.max(
    citedByTable.has('spend') ? store.spend.filter((r) => inScope(r.propertyId)).reduce((a, r) => a + Math.max(r.rawAmount, r.effectiveUsd), 0) : 0,
    citedByTable.has('leases') ? store.leases.filter((r) => inScope(r.propertyId)).reduce((a, r) => a + r.monthlyRent, 0) : 0,
    citedByTable.has('units') ? Math.max(0, ...store.units.filter((r) => inScope(r.propertyId)).map((r) => r.marketRent)) : 0,
  );
  for (const m of text2.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)) {
    const n = Number(m[1]);
    if (n <= moneyCeiling || rowMoneyChecked.some((c) => close(n, c))) checked.push(n);
  }
  let open = stated.filter((n) => !checked.some((c) => close(n, c)));
  // One arithmetic step from checked values explains a stated figure; repeat
  // until nothing new is explained. A breakdown whose parts sum to a
  // checked total is explained as a whole.
  for (let changed = true; changed && open.length > 0; ) {
    changed = false;
    const sumOpen = open.reduce((a, b) => a + b, 0);
    if (open.length > 1 && checked.some((c) => close(sumOpen, c))) { checked.push(...open); open = []; break; }
    for (const n of open) {
      const ops = [...core, ...stated.filter((x) => checked.some((c) => close(x, c)) && x !== n)];
      const ok = ops.some((a) => ops.some((b) =>
        close(n, a + b) || close(n, a - b) || close(n, a * b) || (b !== 0 && (close(n, a / b) || close(n, (100 * a) / b))) || close(n, (a * b) / 100)));
      if (ok) { checked.push(n); changed = true; }
    }
    open = open.filter((n) => !checked.includes(n));
  }
  return open;
}
