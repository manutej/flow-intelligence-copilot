import readline from 'node:readline';
import { askFlowIqCopilot } from '../agent/copilot.ts';
import {
  type AgentToolName,
  executeAgentTool,
  FLOWIQ_TOOL_DEFINITIONS,
} from '../agent/tools.ts';
import { loadPortfolioStore } from '../data/loader.ts';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/**
 * Handles a single JSON-RPC 2.0 MCP request (exported for unit tests and stdio loop).
 */
export async function handleMcpJsonRpcRequest(
  req: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const store = loadPortfolioStore();
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'flow-intelligence-mcp',
            version: '2.0.0',
          },
          capabilities: {
            tools: {},
          },
        },
      };
    }

    case 'notifications/initialized': {
      return null;
    }

    case 'ping': {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
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
        ...FLOWIQ_TOOL_DEFINITIONS.map((t) => ({
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

      const validToolNames = new Set<string>(
        FLOWIQ_TOOL_DEFINITIONS.map((t) => t.name),
      );
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

const isMain =
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(
    process.argv[1].replace(/^.*\/(src\/mcp\/server\.ts)$/, '$1'),
  );

if (isMain) {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
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
