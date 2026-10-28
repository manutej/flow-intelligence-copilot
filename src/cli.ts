import readline from 'node:readline';
import { askFlowIqCopilot } from './agent/copilot.ts';
import { loadPortfolioStore } from './data/loader.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useLlm = args.includes('--llm');
  const jsonOutput = args.includes('--json');
  const queryParts = args.filter((a) => a !== '--llm' && a !== '--json');

  const store = loadPortfolioStore();

  if (queryParts.length > 0) {
    const query = queryParts.join(' ');
    const turn = await askFlowIqCopilot(query, {
      mode: useLlm ? 'llm' : 'deterministic',
      store,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(turn.envelope));
      return;
    }

    console.log('\n=== FlowIQ Copilot ===');
    console.log(`Question:  ${query}`);
    if (turn.toolCalls.length > 0) {
      console.log(
        `Tools:     ${turn.toolCalls.map((t) => `${t.toolName}(${JSON.stringify(t.args)}) -> ${t.outputSummary}`).join(' | ')}`,
      );
    }
    if (turn.clarificationNeeded) {
      console.log(`Status:    AMBIGUOUS BUILDING MATCH (FLOW-101 Clarification Gate)`);
    }
    console.log(`Answer:    ${turn.envelope.answer}`);
    console.log(`Result:    ${JSON.stringify(turn.envelope.result)}`);
    console.log(`Citations: ${turn.envelope.citations.join(', ')}`);
    console.log(
      `Verified:  ${turn.verification.valid ? 'PASS (all row IDs verified)' : `FAIL (${turn.verification.errors.join('; ')})`}`,
    );
    return;
  }

  console.log('FlowIQ Interactive Portfolio Copilot (type "exit" to quit)');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nflowiq> ',
  });

  rl.prompt();
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      rl.close();
      return;
    }
    const turn = await askFlowIqCopilot(trimmed, {
      mode: useLlm ? 'llm' : 'deterministic',
      store,
    });
    for (const tc of turn.toolCalls) {
      console.log(`  [tool] ${tc.toolName} -> ${tc.outputSummary}`);
    }
    console.log(`  [answer] ${turn.envelope.answer}`);
    console.log(`  [result] ${JSON.stringify(turn.envelope.result)}`);
    console.log(`  [citations] ${turn.envelope.citations.join(', ')}`);
    rl.prompt();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
