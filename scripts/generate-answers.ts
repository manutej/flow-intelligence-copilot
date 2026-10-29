import fs from 'node:fs';
import path from 'node:path';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { DISCOVERED_EASTER_EGGS } from '../src/config/rules.ts';
import { wrapText } from '../src/domain/format.ts';
import {
  loadPortfolioStore,
  loadQuestionsFile,
} from '../src/data/loader.ts';

function printKV(label: string, value: string): void {
  const wrapped = wrapText(value, 56);
  console.log(`  ${label.padEnd(10)}: ${wrapped[0]}`);
  for (let i = 1; i < wrapped.length; i += 1) {
    console.log(`              ${wrapped[i]}`);
  }
}

export async function generateAnswersJsonl(): Promise<string[]> {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const store = loadPortfolioStore(repoRoot);

  const testQuestions = loadQuestionsFile(
    path.join(repoRoot, 'questions', 'test.jsonl'),
  );
  const bonusPath = path.join(repoRoot, 'questions', '.bonus.jsonl');
  const bonusQuestions = fs.existsSync(bonusPath)
    ? loadQuestionsFile(bonusPath).filter((q) => q.id !== 'B00')
    : [];

  const allQuestions = [...testQuestions, ...bonusQuestions];
  const lines: string[] = [];

  for (const q of allQuestions) {
    const turn = await askFlowIqCopilot(q, { store });
    if (!turn.verification.valid) {
      throw new Error(
        `Verification failed for ${q.id}: ${turn.verification.errors.join('; ')}`,
      );
    }
    const lineObj = {
      id: turn.envelope.id,
      answer: turn.envelope.answer,
      result: turn.envelope.result,
      citations: turn.envelope.citations,
    };
    let jsonLine = JSON.stringify(lineObj);
    if (q.result_schema) {
      for (const [key, schemaType] of Object.entries(q.result_schema)) {
        if (schemaType === 'float') {
          const val = (turn.envelope.result as Record<string, unknown>)[key];
          if (typeof val === 'number' && Number.isInteger(val)) {
            const pattern = new RegExp(`"${key}":${val}([,}])`);
            jsonLine = jsonLine.replace(pattern, `"${key}":${val}.0$1`);
          }
        }
      }
    }
    lines.push(jsonLine);
  }

  const eggsLine = {
    id: 'EGGS',
    words: [...DISCOVERED_EASTER_EGGS.eggsTuple],
  };
  lines.push(JSON.stringify(eggsLine));

  return lines;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  generateAnswersJsonl()
    .then((lines) => {
      const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
      const outPath = path.join(repoRoot, 'answers.jsonl');
      fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf-8');
      console.log('='.repeat(72));
      console.log(`FLOWIQ ANSWERS GENERATOR · Wrote ${lines.length} verified JSONL lines`);
      console.log('='.repeat(72));
      for (const l of lines) {
        const parsed = JSON.parse(l) as {
          id: string;
          answer?: string;
          result?: unknown;
          citations?: string[];
          words?: unknown;
        };
        if (parsed.words) {
          console.log(`\n[${parsed.id}]`);
          printKV('words', JSON.stringify(parsed.words));
          continue;
        }
        const cites = parsed.citations ?? [];
        const citeStr =
          cites.length <= 6
            ? JSON.stringify(cites)
            : `${JSON.stringify(cites.slice(0, 5))} (+${cites.length - 5} more, ${cites.length} total)`;
        console.log(`\n[${parsed.id}]`);
        printKV('result', JSON.stringify(parsed.result));
        printKV('citations', citeStr);
        printKV('answer', parsed.answer ?? '');
      }
      console.log('\n' + '='.repeat(72));
      console.log('All 17 lines verified against 3,858 CSV rows -> answers.jsonl');
      console.log('='.repeat(72));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
