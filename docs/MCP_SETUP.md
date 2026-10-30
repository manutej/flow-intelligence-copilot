# Ask your own agent: connecting FlowIQ

FlowIQ is an MCP server. Connect it once and ask portfolio questions from the assistant you already use. Every tool is read-only, needs no key, and runs the deterministic engine over the committed exports, so the same question always gets the same answer with the same source rows.

**Endpoint:** `https://repo-sigma-one-80.vercel.app/api/mcp` (MCP Streamable HTTP, POST, no auth)

> The endpoint goes live with the next deployment of this branch. Until then, use the local options at the bottom.

What you get:

| Tool | Use it for |
|---|---|
| `ask_flowiq` | Any question in plain English. Returns a short answer plus the source rows it used. Says "I don't know" when the exports cannot answer, asks which building when a name is ambiguous, and refuses Fair Housing violations. Takes an optional `assumptions` what-if (CAD rate, notice-as-occupied, lease date bucket, prior cost per lease). |
| `find_properties`, `query_units_and_occupancy`, `query_leases_and_renewals`, `query_marketing_spend_and_funnel`, `evaluate_budget_decisions`, `audit_sheaf_consistency` | Structured data behind the answers, for agents that want to do their own analysis. |

## Grok Bot

Grok Bot has no settings form for MCP servers; you add one in chat.

1. In any Grok Bot chat, send: `Add a custom MCP server called flowiq at https://repo-sigma-one-80.vercel.app/api/mcp`
2. Check the name and URL on the confirmation card and click to add it. There is no sign-in step; the bot reports 8 tools: `ask_flowiq`, the six `find_`/`query_`/`evaluate_`/`audit_` tools, and `flowiq_about` (a deployment from before this branch reports 7, without `flowiq_about`).
3. Ask: `Using flowiq, which paid source cost us the least per signed lease at Kedzie Works from April to September 2026?`
   Expected: Google Ads at $2,005.00 ($4,010.00 over 2 signed leases), with source rows such as `spend:S0125` and `leases:L00105`.

The server is added to your account, so every bot you own can use it. Type `@flowiq` in a chat to point a question at it.

## Grok on grok.com

1. Go to grok.com/connectors.
2. Click **New Connector**, then **Custom**.
3. Paste `https://repo-sigma-one-80.vercel.app/api/mcp`. No authentication is needed.

## xAI API (Responses API remote MCP tool)

xAI connects to the server for you; your code only lists it in `tools`. The field names below are from docs.x.ai/developers/tools/remote-mcp (checked 2026-10-29). `server_url` and `server_label` are required; `allowed_tools` is optional. The current docs name `grok-4.7` as the model to use.

```bash
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
  "model": "grok-4.7",
  "input": [
    {
      "role": "user",
      "content": "Which paid source cost us the least per signed lease at Kedzie Works from April to September 2026? Cite the source rows."
    }
  ],
  "tools": [
    {
      "type": "mcp",
      "server_url": "https://repo-sigma-one-80.vercel.app/api/mcp",
      "server_label": "flowiq",
      "server_description": "Read-only answers about an eight-building Chicago apartment portfolio, with source-row citations.",
      "allowed_tools": ["ask_flowiq"]
    }
  ]
}'
```

Python, with the OpenAI SDK pointed at xAI:

```python
import os
from openai import OpenAI

client = OpenAI(api_key=os.getenv("XAI_API_KEY"), base_url="https://api.x.ai/v1")

response = client.responses.create(
    model="grok-4.7",
    input=[{"role": "user", "content": "What if the Canadian dollar were 0.80? How much did we spend on paid sources that signed no leases from April to September 2026?"}],
    tools=[
        {
            "type": "mcp",
            "server_url": "https://repo-sigma-one-80.vercel.app/api/mcp",
            "server_label": "flowiq",
            "allowed_tools": ["ask_flowiq"],
        }
    ],
)
print(response.output_text)
```

Drop `allowed_tools` to give Grok the structured tools as well. `require_approval` and `connector_id` are not supported by xAI; this server needs neither.

## Also works with

### Claude Code, Claude Desktop, Cursor (local, stdio)

These run the server on your machine from a clone of the repo. Node 22.6 or newer, no install step, no keys.

```bash
npm run mcp:install
```

This starts the server from your temp directory to prove it works outside the repo, then prints the exact command or JSON with absolute paths for your machine:

- **Claude Code:** run the printed `claude mcp add flowiq -- /abs/path/to/node --no-warnings /abs/path/to/src/mcp/server.ts`.
- **Cursor:** `npm run mcp:install -- --write cursor` merges a `flowiq` entry into `~/.cursor/mcp.json`, keeping your other servers and saving a `.bak`.
- **Claude Desktop:** `npm run mcp:install -- --write claude-desktop` does the same for `claude_desktop_config.json`. Restart Claude Desktop afterwards.

### Any client that speaks Streamable HTTP

Point it at the endpoint above. For example, `claude mcp add --transport http flowiq https://repo-sigma-one-80.vercel.app/api/mcp`, or in Cursor's `mcp.json`: `{"mcpServers": {"flowiq": {"url": "https://repo-sigma-one-80.vercel.app/api/mcp"}}}`.

## Testing it yourself

| Command | What it checks |
|---|---|
| `npm run mcp:smoke` | stdio server started from `/tmp`: 12 checks (tools, injection trap, unknown and Fair Housing replies as text, what-if, -32602 with the request id). |
| `npm run mcp:http` | Serves the HTTP endpoint locally at `http://127.0.0.1:8787/api/mcp`. Hosted assistants cannot reach localhost; use a tunnel or the deployment. |
| `npm run mcp:http:smoke` | The same 12 checks over HTTP, plus parse errors, batches, GET/DELETE 405 and the 64 KB body limit. |
| `MCP_URL=https://repo-sigma-one-80.vercel.app/api/mcp npm run mcp:http:smoke` | The same suite against the deployment. |

## How the endpoint behaves

- Stateless: no `Mcp-Session-Id`, no SSE stream. `POST` gets a JSON reply; `GET` and `DELETE` return 405.
- Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05 are accepted at `initialize`.
- Bad arguments (missing question, wrong types, unknown building IDs, an assumption outside its range) return JSON-RPC `-32602` with the request id. A question the data cannot answer is not an error: it returns tool text that says so, with `status: "unknown"`.
- Every tool is marked `readOnlyHint: true`. Nothing the endpoint does writes anywhere.
