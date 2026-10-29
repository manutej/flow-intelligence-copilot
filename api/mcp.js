// Remote MCP endpoint (Streamable HTTP): https://<deployment>/api/mcp
// Read-only and keyless: every tool runs the deterministic engine over the
// committed CSVs. The protocol logic lives in src/mcp/http.ts so the local
// server (npm run mcp:http) and this function behave the same.
import { handleMcpHttpRequest } from "../src/mcp/http.ts";

async function readRawBody(req) {
  // Vercel may have parsed a JSON body already; re-serialise it so the
  // handler sees the request as sent.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString("utf-8");
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

export default async function handler(req, res) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  let body = "";
  if (req.method === "POST") {
    try {
      body = await readRawBody(req);
    } catch {
      body = "";
    }
  }
  const out = await handleMcpHttpRequest({ method: req.method || "GET", headers, body });
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.statusCode = out.status;
  res.end(out.body);
}
