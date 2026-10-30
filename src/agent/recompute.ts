import type { PortfolioStore } from '../data/schema.ts';
import { parseQueryIntent } from './intent.ts';

/** The typed query a producer attaches for a question, as the planner does. */
export function typedQuery(question: string, store: PortfolioStore, result_schema?: Readonly<Record<string, string>>) {
  return { question, intent: parseQueryIntent(question, store), ...(result_schema ? { result_schema } : {}) };
}
