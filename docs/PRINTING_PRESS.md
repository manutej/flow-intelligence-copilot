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

On this branch the MCP server is unchanged, apart from the "did you mean" in argument errors. A fuller pass is drafted but not applied: tool titles, shorter selection-tuned descriptions, `additionalProperties: false`, argument `examples`, an `outputSchema` for `ask_flowiq`, plain text plus `structuredContent` for every tool, a `prompts/get` handler for the prompt it already lists, and a `flowiq_about` context tool with the ASCII wordmark. It is the Printing Press "context" tool adapted for FlowIQ, and it would sit outside answers so the art never lands in a reply.
