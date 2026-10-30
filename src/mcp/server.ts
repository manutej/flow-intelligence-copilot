#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { askFlowIqCopilot } from '../agent/copilot.ts';
import { type AgentToolName, executeAgentTool } from '../agent/tools.ts';
import { type PortfolioPolicyConfig, resolvePolicyConfig } from '../config/rules.ts';
import { loadPortfolioStore } from '../data/loader.ts';
import { didYouMean } from '../util/suggest.ts';
import {
  ASK_INPUT_SCHEMA,
  MCP_SERVER_INFO,
  SERVER_INSTRUCTIONS,
  aboutFlowIq,
  aboutFlowIqText,
  listMcpTools,
} from './catalog.ts';
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

type CopilotTurn = Awaited<ReturnType<typeof askFlowIqCopilot>>;

/** One word an assistant can branch on without parsing prose. */
export function answerStatus(turn: CopilotTurn): 'answered' | 'unknown' | 'refused' | 'needs_clarification' {
  const result = turn.envelope.result as Record<string, unknown>;
  if (result.refused === true) return 'refused';
  if (result.unknown === true) return 'unknown';
  if (turn.clarificationNeeded || result.clarification_needed === true) return 'needs_clarification';
  return 'answered';
}

/** At most eight row IDs inline, then a count, so a reply stays short. */
function sourceRowsLine(cites: readonly string[]): string {
  const shown = cites.slice(0, 8).join(', ');
  const more = cites.length > 8 ? `, and ${cites.length - 8} more` : '';
  return `Source rows (${cites.length}): ${shown}${more}.`;
}

/** The plain-English reply an assistant can relay as is. */
export function formatAskReply(
  turn: CopilotTurn,
  assumptions: Readonly<Record<string, unknown>> = {},
): string {
  const status = answerStatus(turn);
  const cites = turn.envelope.citations;
  const lines = [turn.envelope.answer];
  const changed = Object.entries(assumptions);
  if (changed.length > 0) {
    const defaults = resolvePolicyConfig() as unknown as Record<string, unknown>;
    lines.push(
      '',
      `What-if for this answer only: ${changed.map(([k, v]) => `${k} = ${JSON.stringify(v)} (normally ${JSON.stringify(defaults[k])})`).join(', ')}.`,
    );
  }
  if (status === 'answered' && cites.length > 0) {
    lines.push('', sourceRowsLine(cites));
    lines.push('Every cited row was checked against the exports.');
  }
  return lines.join('\n');
}

/** The plain-text half of a structured tool result. */
export function formatToolReply(summary: string, citations: readonly string[]): string {
  return citations.length > 0 ? `${summary}\n\n${sourceRowsLine(citations)}` : summary;
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const PROMPTS = [
  {
    name: 'portfolio-executive-audit',
    title: 'Executive audit',
    description:
      'A short executive audit: dead marketing spend, leases up for renewal, and how past budget decisions turned out.',
  },
] as const;

const PROMPT_TEXT =
  'Give me a short executive audit of the portfolio. Use ask_flowiq for each of these and keep the source rows: ' +
  '1) How much paid spend from April to September 2026 signed no leases, and where would it buy the most leases instead? ' +
  '2) How many leases end in the next quarter, and how much monthly rent is at risk? ' +
  '3) Which past budget decisions turned out worse than expected? ' +
  'Finish with the three actions you would take first.';

const RESOURCES = [
  {
    uri: 'flowiq://about',
    name: 'About FlowIQ',
    mimeType: 'text/markdown',
    description: 'The context card: coverage, row ID format, what-if defaults and which tool to use when.',
  },
  {
    uri: 'flowiq://portfolio/summary',
    name: 'Portfolio summary and policy',
    mimeType: 'application/json',
    description: 'Operating and on-hold buildings, unit counts, rows indexed, and the active policy.',
  },
  {
    uri: 'flowiq://reports/dead-spend',
    name: 'Dead spend and reallocation report',
    mimeType: 'text/markdown',
    description: 'The 9 paid (building, source) pairs with spend and no signed leases, and the reallocation math.',
  },
  {
    uri: 'flowiq://docs/notes',
    name: 'Engineering notes',
    mimeType: 'text/markdown',
    description: 'Architecture, prompt-injection defense, the decision learner, and P09 onboarding.',
  },
] as const;

/**
 * Handles a single JSON-RPC 2.0 MCP request (exported for unit tests and stdio loop).
 * Resolves dataDir relative to `src/data/loader.ts` when `process.cwd()` is outside the repo.
 */
export async function handleMcpJsonRpcRequest(
  req: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  // Notifications without an id do not receive a response
  if (req.method.startsWith('notifications/') || req.id === undefined) {
    return null;
  }

  const store = loadPortfolioStore();
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string, data?: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  });

  switch (req.method) {
    case 'initialize': {
      const requested = req.params?.protocolVersion;
      const clientProtocol =
        typeof requested === 'string' &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
      return ok({
        protocolVersion: clientProtocol,
        serverInfo: MCP_SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
      });
    }

    case 'ping':
      return ok({});

    case 'prompts/list':
      return ok({ prompts: PROMPTS });

    case 'prompts/get': {
      const name = String(req.params?.name ?? '');
      if (name !== PROMPTS[0].name) {
        return fail(-32602, `Unknown prompt: ${name}${didYouMean(name, PROMPTS.map((p) => p.name))}`);
      }
      return ok({
        description: PROMPTS[0].description,
        messages: [{ role: 'user', content: { type: 'text', text: PROMPT_TEXT } }],
      });
    }

    case 'resources/list':
      return ok({ resources: RESOURCES });

    case 'resources/read': {
      const uri = String(req.params?.uri ?? '');
      if (uri === 'flowiq://about') {
        return ok({ contents: [{ uri, mimeType: 'text/markdown', text: aboutFlowIqText(store) }] });
      }
      if (uri === 'flowiq://portfolio/summary') {
        const summary = {
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
        };
        return ok({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }] });
      }
      if (uri === 'flowiq://reports/dead-spend') {
        const p = path.join(REPO_ROOT, 'reports', 'dead-spend-and-decisions.md');
        const text = fs.existsSync(p)
          ? fs.readFileSync(p, 'utf-8')
          : 'Dead-spend report: 9 zero-lease paid pairs = $46,599.90 USD -> +15 leases on Apartments.com ($2,915.86/lease).';
        return ok({ contents: [{ uri, mimeType: 'text/markdown', text }] });
      }
      if (uri === 'flowiq://docs/notes') {
        const p = path.join(REPO_ROOT, 'NOTES.md');
        const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : 'FlowIQ Engineering Notes (FLOW-101..106)';
        return ok({ contents: [{ uri, mimeType: 'text/markdown', text }] });
      }
      return fail(-32602, `Unknown resource URI: ${uri}${didYouMean(uri, RESOURCES.map((r) => r.uri))}`);
    }

    case 'tools/list':
      return ok({ tools: listMcpTools(store, READ_ONLY_ANNOTATIONS) });

    case 'tools/call': {
      const params = req.params ?? {};
      const toolName = String(params.name ?? '');
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const invalidParams = (problems: readonly string[]): JsonRpcResponse =>
        fail(-32602, `Invalid params for ${toolName}: ${problems.join('; ')}`, { problems });
      const tools = listMcpTools(store, READ_ONLY_ANNOTATIONS);
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        // The MCP spec reports an unknown tool as invalid params.
        return fail(
          -32602,
          `Unknown tool: ${toolName}${didYouMean(toolName, tools.map((t) => t.name))}`,
          { tools: tools.map((t) => t.name) },
        );
      }

      if (toolName === 'flowiq_about') {
        const problems = validateToolArguments(toolArgs, { properties: {} }, store);
        if (problems.length > 0) return invalidParams(problems);
        const card = aboutFlowIq(store);
        return ok({
          content: [
            { type: 'text', text: aboutFlowIqText(store) },
            { type: 'text', text: JSON.stringify(card, null, 2) },
          ],
          structuredContent: card,
        });
      }

      if (toolName === 'ask_flowiq') {
        const problems = validateToolArguments(
          toolArgs,
          ASK_INPUT_SCHEMA as unknown as Parameters<typeof validateToolArguments>[1],
          store,
        );
        if (problems.length > 0) return invalidParams(problems);
        const question = String(toolArgs.question).trim();
        if (!question) return invalidParams(['"question" must not be blank']);
        // A what-if applies to this one call only; nothing is saved.
        const assumptions = (toolArgs.assumptions ?? {}) as Partial<PortfolioPolicyConfig>;
        const askStore = Object.keys(assumptions).length > 0 ? loadPortfolioStore(undefined, assumptions) : store;
        // Deterministic planner only: no provider option is passed, so no
        // model is called and no key is needed.
        const turn = await askFlowIqCopilot(question, { store: askStore });
        // "I don't know", a refusal, or a clarifying question is a normal
        // answer, so it comes back as tool text, never as an error.
        const structured = {
          status: answerStatus(turn),
          assumptions,
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
        return ok({
          content: [
            { type: 'text', text: formatAskReply(turn, assumptions) },
            { type: 'text', text: JSON.stringify(structured, null, 2) },
          ],
          structuredContent: structured,
        });
      }

      const problems = validateToolArguments(
        toolArgs,
        tool.inputSchema as Parameters<typeof validateToolArguments>[1],
        store,
      );
      if (problems.length > 0) return invalidParams(problems);

      let trace: ReturnType<typeof executeAgentTool>;
      try {
        trace = executeAgentTool(store, toolName as AgentToolName, toolArgs);
      } catch (err) {
        // A tool failure is a tool result, not a protocol error, so the
        // client keeps the request id and the assistant can read the reason.
        return ok({
          isError: true,
          content: [{ type: 'text', text: `${toolName} failed: ${err instanceof Error ? err.message : String(err)}` }],
        });
      }
      const structured = {
        toolName: trace.toolName,
        summary: trace.outputSummary,
        citations: trace.citations,
        data: trace.rawOutput,
      };
      return ok({
        content: [
          { type: 'text', text: formatToolReply(trace.outputSummary, trace.citations) },
          { type: 'text', text: JSON.stringify(structured, null, 2) },
        ],
        structuredContent: structured,
      });
    }

    default:
      return fail(-32601, `Method not found: ${req.method}`);
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
