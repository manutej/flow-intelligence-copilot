/** Rewrite grammar/flowiq-typedquery.gbnf from typed-query-grammar.ts. */
import fs from 'node:fs';
import { DEFAULT_GRAMMAR } from '../src/agent/model-parse.ts';
import { typedQueryGrammar } from '../src/agent/typed-query-grammar.ts';
import { loadPortfolioStore } from '../src/data/loader.ts';

fs.writeFileSync(DEFAULT_GRAMMAR, typedQueryGrammar(loadPortfolioStore()));
console.log(`wrote ${DEFAULT_GRAMMAR}`);
