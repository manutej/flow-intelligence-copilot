/**
 * Local Streamable HTTP MCP server: the same handler Vercel runs at /api/mcp.
 *   npm run mcp:http            # http://127.0.0.1:8787/api/mcp
 *   PORT=9000 npm run mcp:http
 * Binds to 127.0.0.1 only; use a tunnel if a hosted client must reach it.
 */
import http, { type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMcpHttpRequest } from '../src/mcp/http.ts';

export const MCP_HTTP_PATH = '/api/mcp';

export function startMcpHttpServer(port: number, host = '127.0.0.1'): Promise<Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== MCP_HTTP_PATH && url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found. The MCP endpoint is ${MCP_HTTP_PATH}\n`);
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
      }
      const out = await handleMcpHttpRequest({
        method: req.method ?? 'GET',
        headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? '8787', 10);
  startMcpHttpServer(port).then(() => {
    console.log(`FlowIQ MCP (Streamable HTTP) on http://127.0.0.1:${port}${MCP_HTTP_PATH}`);
  });
}
