import fs from 'node:fs';
import path from 'node:path';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { DISCOVERED_EASTER_EGGS } from '../src/config/rules.ts';
import {
  loadPortfolioStore,
  loadQuestionsFile,
} from '../src/data/loader.ts';

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
        if (schemaType === "float") {
          const val = (turn.envelope.result as Record<string, unknown>)[key];
          if (typeof val === "number" && Number.isInteger(val)) {
            const pattern = new RegExp(`"${key}":${val}([,}])`);
            jsonLine = jsonLine.replace(pattern, `"${key}":${val}.0$1`);
          }
        }
      }
    }
    lines.push(jsonLine);
  }

  // Append B00 hidden EGGS line matching .bonus.jsonl literally
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
      console.log(`Generated ${outPath} (${lines.length} lines):`);
      for (const l of lines) {
        const parsed = JSON.parse(l) as {
          id: string;
          result?: unknown;
          words?: unknown;
        };
        console.log(
          `  ${parsed.id.padEnd(5)} -> ${JSON.stringify(parsed.result ?? { words: parsed.words })}`,
        );
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
