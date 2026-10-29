/**
 * MCP Streamable HTTP transport (spec 2025-03-26 / 2025-06-18), stateless.
 *
 * One POST carries one JSON-RPC message (or a batch) and gets one JSON
 * reply. There are no sessions and no server-initiated messages, so GET
 * (the optional SSE stream) and DELETE (session teardown) return 405, as
 * the spec allows. Every tool is read-only and runs the deterministic
 * engine, so the endpoint needs no key and changes nothing.
 *
 * This module is framework-free: `api/mcp.js` (Vercel) and
 * `scripts/mcp-http-server.ts` (local) both adapt their request objects
 * to `handleMcpHttpRequest`.
 */
import {
  handleMcpJsonRpcRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './server.ts';

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

function isJsonRpcMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function handleOne(msg: unknown): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcMessage(msg)) {
    return rpcError(null, -32600, 'Invalid Request: expected a JSON-RPC object');
  }
  const id =
    typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
  // A response or notification from the client needs no reply.
  if (!('method' in msg)) return null;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(id, -32600, 'Invalid Request: jsonrpc must be "2.0" and method a string');
  }
  try {
    return await handleMcpJsonRpcRequest(msg as unknown as JsonRpcRequest);
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

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return json(400, rpcError(null, -32600, 'Invalid Request: empty batch'));
    }
    const replies = (await Promise.all(parsed.map(handleOne))).filter(
      (r): r is JsonRpcResponse => r !== null,
    );
    return replies.length === 0
      ? { status: 202, headers: { ...CORS_HEADERS }, body: '' }
      : json(200, replies);
  }

  const reply = await handleOne(parsed);
  if (reply === null) return { status: 202, headers: { ...CORS_HEADERS }, body: '' };
  // Protocol errors still travel as HTTP 200 with a JSON-RPC error body
  // (except an unparseable request), so clients keep the request id.
  return json(200, reply);
}
