import { it as test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortfolioStore } from '../../src/data/loader.ts';
import { verifyAnswerEnvelope } from '../../src/domain/guards.ts';
import type { AnswerEnvelope } from '../../src/data/schema.ts';
import { rng, SEEDS } from './rng.ts';

// FX3c (F-036): a true unit-count envelope verifies; every forgery the
// generator makes from it (a second invented figure, a schema break, a
// status synonym over the wrong unit, a unit from an unnamed building) fails.
const store = loadPortfolioStore();
const STATUS_SYNONYMS = { vacant: ['vacant', 'empty', 'available', 'unoccupied'], occupied: ['occupied', 'taken', 'leased', 'rented'] } as const;

function trueEnvelope(r: ReturnType<typeof rng>): { env: AnswerEnvelope; pid: string; status: 'vacant' | 'occupied' } {
  for (;;) {
    const p = r.pick(store.operatingProperties);
    const status = r.pick(['vacant', 'occupied'] as const);
    const rows = store.units.filter((u) => u.propertyId === p.propertyId && u.status === status);
    if (rows.length === 0) continue;
    const word = r.pick(STATUS_SYNONYMS[status]);
    const answer = r.pick([
      `${p.name} (${p.propertyId}) has ${rows.length} ${word} units.`,
      `${p.name} (${p.propertyId}) has ${rows.length} ${word} units (out of ${p.actualUnitCount} total units).`,
      `At ${p.name} (${p.propertyId}), ${rows.length} units are ${word}.`,
    ]);
    return {
      env: { id: 'FUZZ', answer, result: { property_id: p.propertyId, count: rows.length }, citations: [p.citationId, ...rows.slice(0, 5).map((u) => u.citationId)] },
      pid: p.propertyId,
      status,
    };
  }
}

const valid = (e: AnswerEnvelope) => verifyAnswerEnvelope(e, store).valid;

test('FX3c fuzz: true envelopes verify, every forgery of them fails', () => {
  const missed: string[] = [];
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let i = 0; i < 10; i++) {
      const { env, pid, status } = trueEnvelope(r);
      assert.ok(valid(env), `seed ${seed}: true envelope rejected: ${env.answer} ${verifyAnswerEnvelope(env, store).errors}`);
      const other = store.units.find((u) => u.propertyId === pid && u.status !== status && u.status !== 'notice');
      const foreign = r.pick(store.units.filter((u) => u.propertyId !== pid));
      const n = r.int(200, 99999);
      const forgeries: Array<[string, AnswerEnvelope]> = [
        ['extra figure', { ...env, answer: env.answer.replace(/\.$/, `, ${n} of them ${r.word()}.`) }],
        ['extra money', { ...env, answer: env.answer.replace(/\.$/, `, worth $${n * 1000 + 0.5}.`) }],
        ['string count', { ...env, result: { ...env.result, count: String(env.result.count) } }],
        ['fractional count', { ...env, result: { ...env.result, count: Number(env.result.count) + 0.5 } }],
        ['percent over 100', { ...env, result: { ...env.result, percent: r.int(101, 900) } }],
        ['rate over 1', { ...env, result: { ...env.result, [r.pick(['rate', 'share', 'vacancy_rate'])]: 1 + r.int(1, 99) / 100 } }],
        ['unknown key', { ...env, result: { ...env.result, [r.word()]: r.int(0, 9) } }],
        ['unknown property', { ...env, result: { ...env.result, property_id: `P${r.int(100, 999)}` } }],
        ['foreign unit', { ...env, citations: [...env.citations, foreign.citationId] }],
        ...(other ? [['wrong status', { ...env, citations: [...env.citations, other.citationId] }] as [string, AnswerEnvelope]] : []),
      ];
      for (const [kind, f] of forgeries) if (valid(f)) missed.push(`seed ${seed} ${kind}: ${f.answer} ${JSON.stringify(f.result)}`);
    }
  }
  assert.deepEqual(missed, []);
});
