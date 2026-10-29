#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { askFlowIqCopilot } from '../agent/copilot.ts';
import {
  type AgentToolName,
  buildFlowIqToolDefinitions,
  executeAgentTool,
} from '../agent/tools.ts';
import { loadPortfolioStore } from '../data/loader.ts';
import { validateToolArguments } from './validate.ts';

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/** Protocol versions this server speaks, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** Every tool only reads the exports; clients can call them without approval prompts. */
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const ASK_FLOWIQ_DESCRIPTION =
  'Ask a question about the apartment portfolio in plain English, the way an operator would: occupancy, vacancies, rent, renewals, rent at risk, concessions, marketing spend, cost per signed lease, dead spend, or past budget decisions. ' +
  'Returns a short answer with the source rows it used (for example leases:L00105). ' +
  'If the exports cannot answer, it says so instead of guessing; if a building name is ambiguous, it asks which one; it refuses requests that would screen or target people by a protected class under the Fair Housing Act. ' +
  'Pass the user\'s question through as written.';

type CopilotTurn = Awaited<ReturnType<typeof askFlowIqCopilot>>;

/** One word an assistant can branch on without parsing prose. */
export function answerStatus(turn: CopilotTurn): 'answered' | 'unknown' | 'refused' | 'needs_clarification' {
  const result = turn.envelope.result as Record<string, unknown>;
  if (result.refused === true) return 'refused';
  if (result.unknown === true) return 'unknown';
  if (turn.clarificationNeeded || result.clarification_needed === true) return 'needs_clarification';
  return 'answered';
}

/** The plain-English reply an assistant can relay as is. */
export function formatAskReply(turn: CopilotTurn): string {
  const status = answerStatus(turn);
  const cites = turn.envelope.citations;
  const lines = [turn.envelope.answer];
  if (status === 'answered' && cites.length > 0) {
    const shown = cites.slice(0, 8).join(', ');
    const more = cites.length > 8 ? `, and ${cites.length - 8} more` : '';
    lines.push('', `Source rows (${cites.length}): ${shown}${more}.`);
    lines.push('Every cited row was checked against the exports.');
  }
  return lines.join('\n');
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/**
 * Handles a single JSON-RPC 2.0 MCP request (exported for unit tests and stdio loop).
 * Resolves dataDir relative to `src/data/loader.ts` when `process.cwd()` is outside the repo.
 */
export async function handleMcpJsonRpcRequest(
  req: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const store = loadPortfolioStore();
  const id = req.id ?? null;
  const dynamicToolDefs = buildFlowIqToolDefinitions(store);

  // Notifications without an id do not receive a response
  if (req.method.startsWith('notifications/') || req.id === undefined) {
    return null;
  }

  switch (req.method) {
    case 'initialize': {
      const requested = req.params?.protocolVersion;
      const clientProtocol =
        typeof requested === 'string' &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: clientProtocol,
          serverInfo: {
            name: 'flow-intelligence-mcp',
            title: 'FlowIQ portfolio copilot',
            version: '2.2.0',
          },
          instructions:
            'Read-only answers over an eight-building Chicago apartment portfolio (P01-P08, plus P09 on onboarding hold). Start with ask_flowiq for any question; use the other tools for structured data. Answers cite source rows; relay them.',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
        },
      };
    }

    case 'ping': {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    case 'prompts/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'portfolio-executive-audit',
              description:
                'Run a complete executive audit across dead marketing spend, lease renewals, and Empirical-Bayes budget decisions.',
            },
          ],
        },
      };
    }

    case 'resources/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'flowiq://portfolio/summary',
              name: 'FlowIQ Portfolio Summary & Policy State',
              mimeType: 'application/json',
              description:
                'Live summary of operating buildings, quarantined onboarding buildings, unit counts, and active runtime policy knobs.',
            },
            {
              uri: 'flowiq://reports/dead-spend',
              name: 'FLOW-102 Dead-Spend & Reallocation Report',
              mimeType: 'text/markdown',
              description:
                'Full breakdown of the 9 zero-lease paid (building, source) pairs ($46,599.90 USD) and +15 lease reallocation math.',
            },
            {
              uri: 'flowiq://docs/notes',
              name: 'FLOW-101..106 Engineering Field Notes (NOTES.md)',
              mimeType: 'text/markdown',
              description:
                'Engineering notes covering architecture, prompt-injection defense, Bayesian decision learner, and P09 onboarding.',
            },
          ],
        },
      };
    }

    case 'resources/read': {
      const uri = String(req.params?.uri ?? '');
      if (uri === 'flowiq://portfolio/summary') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(
                  {
                    operatingBuildings: store.operatingProperties.map((p) => ({
                      propertyId: p.propertyId,
                      name: p.name,
                      neighborhood: p.neighborhood,
                      class: p.buildingClass,
                      pms: p.pms,
                      units: p.actualUnitCount,
                    })),
                    onboardingBuildings: store.onboardingProperties.map((p) => ({
                      propertyId: p.propertyId,
                      name: p.name,
                      pms: p.pms,
                      units: p.actualUnitCount,
                    })),
                    totalIndexedPrimaryKeys: store.primaryKeyIndex.size,
                    policy: store.policy,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        };
      }
      if (uri === 'flowiq://reports/dead-spend') {
        const p = path.join(REPO_ROOT, 'reports', 'dead-spend-and-decisions.md');
        const text = fs.existsSync(p)
          ? fs.readFileSync(p, 'utf-8')
          : 'Dead-spend report: 9 zero-lease paid pairs = $46,599.90 USD -> +15 leases on Apartments.com ($2,915.86/lease).';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [{ uri, mimeType: 'text/markdown', text }],
          },
        };
      }
      if (uri === 'flowiq://docs/notes') {
        const p = path.join(REPO_ROOT, 'NOTES.md');
        const text = fs.existsSync(p)
          ? fs.readFileSync(p, 'utf-8')
          : 'FlowIQ Engineering Notes (FLOW-101..106)';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [{ uri, mimeType: 'text/markdown', text }],
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Unknown resource URI: ${uri}`,
        },
      };
    }

    case 'tools/list': {
      const tools = [
        {
          name: 'ask_flowiq',
          title: 'Ask FlowIQ',
          description: ASK_FLOWIQ_DESCRIPTION,
          annotations: READ_ONLY_ANNOTATIONS,
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description:
                  'The question in plain English, e.g. "Which source cost us the least per signed lease at Kedzie Works this summer?"',
              },
            },
            required: ['question'],
          },
        },
        ...dynamicToolDefs.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        })),
      ];

      return {
        jsonrpc: '2.0',
        id,
        result: { tools },
      };
    }

    case 'tools/call': {
      const params = req.params ?? {};
      const toolName = String(params.name ?? '');
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const invalidParams = (problems: readonly string[]): JsonRpcResponse => ({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Invalid params for ${toolName}: ${problems.join('; ')}`,
          data: { problems },
        },
      });

      if (toolName === 'ask_flowiq') {
        const problems = validateToolArguments(
          toolArgs,
          { properties: { question: { type: 'string' } }, required: ['question'] },
          store,
        );
        if (problems.length > 0) return invalidParams(problems);
        const question = String(toolArgs.question).trim();
        if (!question) return invalidParams(['"question" must not be blank']);
        // Deterministic planner only: no provider option is passed, so no
        // model is called and no key is needed.
        const turn = await askFlowIqCopilot(question, { store });
        // "I don't know", a refusal, or a clarifying question is a normal
        // answer, so it comes back as tool text, never as an error.
        const structured = {
          status: answerStatus(turn),
          answer: turn.envelope.answer,
          result: turn.envelope.result,
          citations: turn.envelope.citations,
          clarificationNeeded: turn.clarificationNeeded,
          toolCalls: turn.toolCalls.map((tc) => ({
            toolName: tc.toolName,
            args: tc.args,
            summary: tc.outputSummary,
          })),
        };
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              { type: 'text', text: formatAskReply(turn) },
              { type: 'text', text: JSON.stringify(structured, null, 2) },
            ],
            structuredContent: structured,
          },
        };
      }

      const validToolNames = new Set<string>(dynamicToolDefs.map((t) => t.name));
      if (!validToolNames.has(toolName)) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${toolName}`,
          },
        };
      }

      const toolDef = dynamicToolDefs.find((t) => t.name === toolName);
      const problems = validateToolArguments(
        toolArgs,
        (toolDef?.inputSchema ?? {}) as Parameters<typeof validateToolArguments>[1],
        store,
      );
      if (problems.length > 0) return invalidParams(problems);

      let trace: ReturnType<typeof executeAgentTool>;
      try {
        trace = executeAgentTool(store, toolName as AgentToolName, toolArgs);
      } catch (err) {
        // A tool failure is a tool result, not a protocol error, so the
        // client keeps the request id and the assistant can read the reason.
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `${toolName} failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  toolName: trace.toolName,
                  summary: trace.outputSummary,
                  citations: trace.citations,
                  data: trace.rawOutput,
                },
                null,
                2,
              ),
            },
          ],
        },
      };
    }

    default: {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${req.method}`,
        },
      };
    }
  }
}

function isExecutedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    const selfPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const argPath = fs.realpathSync(path.resolve(process.argv[1]));
    return selfPath === argPath;
  } catch {
    return fileURLToPath(import.meta.url).endsWith(
      process.argv[1].replace(/^.*\/(src\/mcp\/server\.ts)$/, '$1'),
    );
  }
}

if (isExecutedDirectly()) {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed || /^content-length:/i.test(trimmed)) {
      return;
    }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      // Only an unparseable line has no id to echo back.
      const errResp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: err instanceof Error ? err.message : 'Parse error',
        },
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
      return;
    }
    try {
      const resp = await handleMcpJsonRpcRequest(req);
      if (resp !== null) {
        process.stdout.write(`${JSON.stringify(resp)}\n`);
      }
    } catch (err) {
      const errResp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
    }
  });
}
