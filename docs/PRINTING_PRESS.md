# CLI Printing Press conventions in FlowIQ

[CLI Printing Press](https://printingpress.dev/) ([source](https://github.com/mvanhorn/cli-printing-press)) is a Go generator. From an OpenAPI or GraphQL spec, or from traffic it sniffs, it prints a Cobra CLI (`<api>-pp-cli`) and a matching MCP server (`<api>-pp-mcp`, built on mark3labs/mcp-go). Along the way it adds a local SQLite mirror, agent-native flags, a scorecard and a set of Claude Code skills.

FlowIQ is not a REST wrapper. It is a deterministic engine over six local CSV exports, with no spec to feed the generator. Running the generator would also add Go 1.26 and Claude Code to a repo that today has no dependencies. FlowIQ therefore keeps its zero-dependency TypeScript and adopts the conventions by hand. This page records which ones it took and why.

Sources read: the README, `docs/PATTERNS.md`, `internal/cli/exitcodes.go`, and the generator templates `helpers.go.tmpl`, `agent_context.go.tmpl`, `mcp_tools.go.tmpl` and `main_mcp.go.tmpl`. Also read: Trevin Chow's "10 Principles for Agent-Native CLIs", which the project cites.

## Adopted

| Convention | In FlowIQ |
|---|---|
| Real help for every command, built from one table | `src/cli/commands.ts` drives `--help`, `help <command>`, flag checking and `agent-context` |
| One `--json` flag; machine output on stdout, never wrapped | `ask`, `doctor`, `status`, `validate`, `answers`, `setup`, `version`; `agent-context` and `mcp-config` always print JSON |
| Typed exit codes | 0 ok, 1 a check failed, 2 usage, 3 not found, 10 exports missing, 130 cancelled (the generated CLIs use 2, 3 and 10 the same way) |
| Errors that name the fix and list the valid values | unknown command, flag or enum value comes with "did you mean" (edit distance) and the allowed values; exit 2 |
| Colour only when wanted | off for `--no-color`, `NO_COLOR`, `TERM=dumb`, or when stdout is not a TTY; `FORCE_COLOR` turns it on for recordings |
| Bounded human output | 80 columns at most; wrapping never inserts a character, and `--json` is the copy-safe form |
| Non-interactive by default | `setup` without a terminal and without `--provider` writes nothing and exits 2; the REPL reads piped lines with no prompt |
| `agent-context` introspection with `schema_version` | `flowiq agent-context`: commands, flags, enums, exit codes, env vars, how to read an answer, and the MCP tools and endpoints |
| `doctor` | real counts from the loaded data (it used to print a hard-coded 94.4% occupancy; the data says 93.9%), and exit 1 when a blocking cross-table check fails |
| MCP: unknown arguments rejected with a suggestion | `src/mcp/validate.ts` adds "did you mean" to the existing -32602 error, which still carries the request id |

## Adapted

- **Auto-JSON when piped.** Printing Press switches to JSON whenever stdout is a pipe. FlowIQ answers lead with prose, and the demo recorder pipes the human view, so a pipe gets the same text without colour or banner, and JSON stays opt-in. Agents get `--json` from `agent-context`.
- **`--quiet`** prints the engine's answer sentence and nothing else, unwrapped.
- **Banner.** The ASCII wordmark shows on `--help`, `doctor` and the interactive session, and only on a terminal. It never shows in a pipe, under `--json`, under `--quiet`, or before an answer.

## Skipped

| Printing Press piece | Why not here |
|---|---|
| Go code generation, Cobra, mcp-go | new toolchain and dependencies for a zero-dependency repo; FlowIQ has no API spec |
| SQLite sync, `--data-source live/local`, FTS search | the six CSVs are the source of truth and load in milliseconds |
| Auth doctor, profiles, `--deliver`, `--wait` and jobs | no remote API, no accounts, nothing asynchronous |
| `--dry-run`, `--yes` | every command is read-only except `answers` and `setup`, which write local files on purpose |
| `--select`, `--compact`, `--csv` | answers are small; `--json` with `jq` covers selection |
| Bearer token on the HTTP MCP server | the endpoint is keyless and read-only by design |

## MCP

The server keeps its tool names, its answers, stdio and Streamable HTTP, no key, and read-only tools. What an assistant sees changed, after the Printing Press MCP conventions:

- `initialize` returns `serverInfo.title` "FlowIQ by Ormus", version 2.3.0, and instructions that say to call `ask_flowiq` first, relay its first text block, and branch on `structuredContent.status`.
- Every tool has a title and a description tuned for tool selection. Every input schema is closed (`additionalProperties: false`) and carries `examples`.
- `ask_flowiq` has an `outputSchema`. Every tool returns a plain-text block first, the same data as JSON second, and `structuredContent`. For the `query_*` tools the first block used to be the JSON; it is now a sentence plus the source rows line, and the JSON is the second block.
- `flowiq_about` (tool) and `flowiq://about` (resource) are the Printing Press "context" tool for FlowIQ: the ASCII wordmark in a code block, coverage, the row ID format, what it cannot answer, the what-if defaults and which tool to use when. The art lives only there, never inside an answer.
- `prompts/get` serves the `portfolio-executive-audit` prompt that `prompts/list` already named.
- An unknown tool is -32602 with the closest name and the request id (was -32601); unknown arguments name the closest allowed one.

The presentation lives in `src/mcp/catalog.ts`; the engine tools in `src/agent/tools.ts` are untouched. The HTTP endpoint runs the same handler, so both transports match.
