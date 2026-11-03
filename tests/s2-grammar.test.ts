import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_GRAMMAR } from '../src/agent/model-parse.ts';
import { typedQueryGrammar } from '../src/agent/typed-query-grammar.ts';
import { AGGREGATION_SET, DOMAIN_SET, MEASURES, STATUSES } from '../src/agent/typed-query.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';
import { unknownWords } from '../src/domain/vocabulary.ts';

const store = loadPortfolioStore();
const grammar = fs.readFileSync(DEFAULT_GRAMMAR, 'utf8');
const rule = (name: string) => grammar.match(new RegExp(`^${name} ::= (.*)$`, 'm'))![1];
const values = (name: string) => [...rule(name).matchAll(/"\\"([^"\\]+)\\""/g)].map((m) => m[1]).sort();

test('the GBNF file is the generated grammar (no hand edits, no drift)', () => {
  assert.equal(grammar, typedQueryGrammar(store), 'run node scripts/gen-grammar.ts');
});
test('grammar enums equal the validator sets', () => {
  assert.deepEqual(values('domain'), [...DOMAIN_SET].sort());
  assert.deepEqual(values('measure'), [...MEASURES].sort());
  assert.deepEqual(values('aggregation'), [...AGGREGATION_SET].sort());
  assert.deepEqual(values('unit-status'), [...STATUSES].sort());
});
test('unitStatusIn is a sorted distinct pair and cannot appear with unitStatus', () => {
  assert.equal(rule('unit-status-pair').split('|').length, 3);
  assert.doesNotMatch(rule('unit-status-pair'), /\\"(\w+)\\",\\"\1\\"/);
  assert.match(grammar, /\( ",\\"unitStatus\\":" unit-status \| ",\\"unitStatusIn\\":" unit-status-pair \)\?/);
});
test('filler carries no constraint; typos, periods and follow-ups stay unknown', () => {
  assert.deepEqual(unknownWords('hey quick q, um, how many vacant units are at Kedzie Works? lol thx', store).filter((w) => w !== 'q'), []);
  assert.ok(unknownWords('How many builidngs have vacancies?', store).includes('builidngs'));
  assert.ok(unknownWords('And what about Halsted & Lake?', store).includes('about'));
});
