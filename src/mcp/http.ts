/**
 * MCP Streamable HTTP transport (spec 2025-03-26 / 2025-06-18).
 *
 * One POST carries one JSON-RPC message (or a batch) and gets one JSON
 * reply. initialize mints an Mcp-Session-Id; later requests that send it
 * share one fair-housing session, so a refusal carries over to that
 * client's follow-ups and never to another client's. A request without a
 * known id gets a fresh session. There are no server-initiated messages,
 * so GET (the optional SSE stream) and DELETE return 405, as the spec
 * allows. Every tool is read-only and runs the deterministic
 * engine, so the endpoint needs no key and changes nothing.
 *
 * This module is framework-free: `api/mcp.js` (Vercel) and
 * `scripts/mcp-http-server.ts` (local) both adapt their request objects
 * to `handleMcpHttpRequest`.
 */
import {
  classifyIncoming,
  handleMcpJsonRpcRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './server.ts';
import { randomUUID } from 'node:crypto';
import type { FairHousingSession } from '../domain/fair-housing.ts';

/** Sessions by Mcp-Session-Id, oldest first; capped so idle clients cannot grow it. */
const SESSIONS = new Map<string, FairHousingSession>();
const MAX_SESSIONS = 1000;

function newSession(): [string, FairHousingSession] {
  const id = randomUUID();
  const session: FairHousingSession = { refusedEarlier: false };
  SESSIONS.set(id, session);
  if (SESSIONS.size > MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value as string);
  return [id, session];
}

export interface McpHttpRequest {
  readonly method: string;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface McpHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Large enough for any question; small enough that nobody streams a file at us. */
export const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function json(status: number, payload: unknown): McpHttpResponse {
  return {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function rpcError(id: JsonRpcResponse['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleOne(msg: unknown, session: FairHousingSession): Promise<JsonRpcResponse | null> {
  const incoming = classifyIncoming(msg);
  if (incoming.kind === 'client_response') return null;
  if (incoming.kind === 'invalid') {
    return rpcError(incoming.id, -32600, 'Invalid Request: jsonrpc must be "2.0" and method a string');
  }
  const id = incoming.request.id ?? null;
  try {
    return await handleMcpJsonRpcRequest(incoming.request, session);
  } catch (err) {
    return rpcError(id, -32603, err instanceof Error ? err.message : 'Internal error');
  }
}

export async function handleMcpHttpRequest(req: McpHttpRequest): Promise<McpHttpResponse> {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') {
    return { status: 204, headers: { ...CORS_HEADERS }, body: '' };
  }
  if (method === 'GET' || method === 'DELETE') {
    return {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' },
      body: JSON.stringify(
        rpcError(null, -32000, 'This server is stateless: send JSON-RPC messages with POST. No SSE stream or session to open or close.'),
      ),
    };
  }
  if (method !== 'POST') {
    return {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcError(null, -32000, `Method ${method} not allowed`)),
    };
  }
  if (Buffer.byteLength(req.body, 'utf-8') > MAX_BODY_BYTES) {
    return json(413, rpcError(null, -32600, `Request body over ${MAX_BODY_BYTES} bytes`));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch (err) {
    return json(400, rpcError(null, -32700, `Parse error: ${err instanceof Error ? err.message : 'invalid JSON'}`));
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const initializing = messages.some((m) => (m as { method?: unknown } | null)?.method === 'initialize');
  const known = SESSIONS.get(req.headers['mcp-session-id'] ?? '');
  const [sessionId, session] =
    initializing || known === undefined ? newSession() : [req.headers['mcp-session-id'] as string, known];
  const withId = (r: McpHttpResponse): McpHttpResponse =>
    initializing ? { ...r, headers: { ...r.headers, 'Mcp-Session-Id': sessionId } } : r;

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return json(400, rpcError(null, -32600, 'Invalid Request: empty batch'));
    }
    const replies = (await Promise.all(parsed.map((m) => handleOne(m, session)))).filter(
      (r): r is JsonRpcResponse => r !== null,
    );
    return withId(
      replies.length === 0 ? { status: 202, headers: { ...CORS_HEADERS }, body: '' } : json(200, replies),
    );
  }

  const reply = await handleOne(parsed, session);
  if (reply === null) return withId({ status: 202, headers: { ...CORS_HEADERS }, body: '' });
  // Protocol errors still travel as HTTP 200 with a JSON-RPC error body
  // (except an unparseable request), so clients keep the request id.
  return withId(json(200, reply));
}
