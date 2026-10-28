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
      const clientProtocol =
        typeof req.params?.protocolVersion === 'string'
          ? req.params.protocolVersion
          : '2024-11-05';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: clientProtocol,
          serverInfo: {
            name: 'flow-intelligence-mcp',
            version: '2.1.0',
          },
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
          description:
            'Ask the FlowIQ multifamily portfolio copilot any natural-language question across properties, units, leases, renewals, CRM leads, ILS marketing spend, and budget decisions. Enforces FLOW-101 ambiguity clarification, FLOW-102 dead-spend analysis, FLOW-103 Fair Housing/unknown/citation verification, and FLOW-105 outcome learning.',
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description:
                  'Natural language operator question (e.g. "Which South Loop building has a doorman, and what is the average market rent of its one-bedroom units?")',
              },
            },
            required: ['question'],
          },
        },
        ...dynamicToolDefs.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
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

      if (toolName === 'ask_flowiq') {
        const question = String(toolArgs.question ?? '');
        const turn = await askFlowIqCopilot(question, { store });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    answer: turn.envelope.answer,
                    result: turn.envelope.result,
                    citations: turn.envelope.citations,
                    clarificationNeeded: turn.clarificationNeeded,
                    toolCalls: turn.toolCalls.map((tc) => ({
                      toolName: tc.toolName,
                      args: tc.args,
                      summary: tc.outputSummary,
                    })),
                  },
                  null,
                  2,
                ),
              },
            ],
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

      const trace = executeAgentTool(
        store,
        toolName as AgentToolName,
        toolArgs,
      );
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
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const resp = await handleMcpJsonRpcRequest(req);
      if (resp !== null) {
        process.stdout.write(`${JSON.stringify(resp)}\n`);
      }
    } catch (err) {
      const errResp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: err instanceof Error ? err.message : 'Parse error',
        },
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
    }
  });
}
