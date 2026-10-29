/**
 * The CLI's command surface in one table. Help text, per-command help,
 * flag checking, "did you mean", and `flowiq agent-context` all read it,
 * so what an agent is told and what the parser accepts cannot drift.
 */

/** Typed exit codes, after the Printing Press convention. */
export const EXIT = {
  ok: 0,
  /** A check ran and failed: validate mismatch, doctor blocking anomaly. */
  failed: 1,
  usage: 2,
  notFound: 3,
  /** The CSV exports could not be loaded. */
  config: 10,
  cancelled: 130,
} as const;

export const EXIT_CODE_DOCS: ReadonlyArray<{ code: number; meaning: string }> = [
  { code: EXIT.ok, meaning: 'success; an "I don\'t know" or a refusal is a valid answer' },
  { code: EXIT.failed, meaning: 'a check failed (validate mismatch, doctor blocking anomaly) or an unexpected error' },
  { code: EXIT.usage, meaning: 'usage error: unknown command or flag, missing or bad value' },
  { code: EXIT.notFound, meaning: 'not found: unknown kit item ID' },
  { code: EXIT.config, meaning: 'the CSV exports could not be loaded' },
  { code: EXIT.cancelled, meaning: 'cancelled (Ctrl+C or Ctrl+D in an interactive prompt)' },
];

export interface FlagSpec {
  readonly name: string;
  /** Placeholder for the value, e.g. "N"; absent for a boolean flag. */
  readonly value?: string;
  readonly enum?: readonly string[];
  readonly summary: string;
  readonly alias?: string;
}

export interface CommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly group: 'ask' | 'data' | 'agents' | 'setup' | 'demo';
  readonly summary: string;
  readonly usage: readonly string[];
  readonly description: string;
  readonly flags?: readonly FlagSpec[];
  readonly examples?: readonly string[];
  /** Commands that print JSON with --json. */
  readonly json?: boolean;
  /** Hidden from the main help; still listed by agent-context. */
  readonly hidden?: boolean;
}

export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: '--json', summary: 'machine-readable output on stdout' },
  { name: '--no-color', summary: 'plain text; also NO_COLOR=1, TERM=dumb, or a pipe' },
  { name: '--quiet', alias: '-q', summary: 'no banner or headers; the answer only' },
  { name: '--help', alias: '-h', summary: 'help for any command: flowiq help ask' },
  { name: '--version', alias: '-V', summary: 'print the version' },
];

export const PROVIDERS = ['xai', 'anthropic', 'openai', 'openrouter', 'ollama', 'local', 'deterministic'] as const;
export const BUCKETS = ['lease_start_date', 'lead_created_date'] as const;

const WHAT_IF_FLAGS: readonly FlagSpec[] = [
  { name: '--cad-rate', value: 'N', summary: 'what-if: USD per Canadian dollar (default 0.73)' },
  { name: '--exclude-notice', summary: 'what-if: count units on notice as not occupied' },
  { name: '--bucket-by', value: 'F', enum: BUCKETS, summary: 'what-if: which date puts a lease in a period' },
  { name: '--beta0', value: 'N', summary: 'what-if: prior cost per signed lease (default 3250)' },
];

const HARNESS_FLAGS: readonly FlagSpec[] = [
  { name: '--llm', summary: 'route through the configured model harness' },
  { name: '--provider', value: 'P', enum: PROVIDERS, summary: 'model provider for --llm' },
  { name: '--model', value: 'M', summary: 'model id for the provider' },
  { name: '--base-url', value: 'URL', summary: 'endpoint for the provider' },
];

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'ask',
    group: 'ask',
    summary: 'answer one question and cite the rows',
    usage: ['flowiq ask "<question>" [flags]', 'flowiq ask <ID> [flags]'],
    description:
      'Answers one question from the six CSV exports and cites every source row it used. When the exports cannot answer, it says so; when a building name is ambiguous, it asks which one; it refuses requests that would violate the Fair Housing Act. <ID> is a kit item: D01..D10, T01..T13, B01..B03, or EGGS.',
    flags: [
      { name: '--verbose', summary: 'also show the tool trace and the JSONL line' },
      ...WHAT_IF_FLAGS,
      ...HARNESS_FLAGS,
    ],
    examples: [
      'flowiq ask "What is the vacancy rate at Kedzie Works?"',
      'flowiq ask --json T13',
      'flowiq ask --cad-rate 0.8 "Paid spend that signed no leases?"',
    ],
    json: true,
  },
  {
    name: 'repl',
    group: 'ask',
    summary: 'interactive session (also: flowiq with no arguments)',
    usage: ['flowiq repl', 'flowiq'],
    description:
      'Ask questions one after another. Type /help for the commands. Reading from a pipe, it answers each line in turn with no prompt.',
  },
  {
    name: 'doctor',
    group: 'data',
    summary: 'data, traps and model harness health',
    usage: ['flowiq doctor [--json]'],
    description:
      'Loads the exports and reports row counts, the six cross-table checks, the six data traps the engine handles, and which model providers are reachable. Exits 1 when a blocking check finds anomalies.',
    json: true,
  },
  {
    name: 'status',
    group: 'data',
    summary: 'one-screen summary: data, policy, harness, MCP',
    usage: ['flowiq status [--json]'],
    description: 'A short summary of what is loaded and configured. Makes no network calls.',
    json: true,
  },
  {
    name: 'validate',
    group: 'data',
    summary: 'run the kit items against expected answers',
    usage: ['flowiq validate [ID] [--json]'],
    description:
      'Answers every kit item (or one, by ID) and checks the schema, the citations, and the published expected values. Exits 1 on any mismatch, 3 for an unknown ID.',
    json: true,
  },
  {
    name: 'answers',
    group: 'data',
    summary: 'regenerate answers.jsonl',
    usage: ['flowiq answers'],
    description: 'Writes answers.jsonl (T01..T13, B01..B03, EGGS) and prints each line.',
  },
  {
    name: 'agent-context',
    group: 'agents',
    summary: 'commands, flags and exit codes as JSON',
    usage: ['flowiq agent-context'],
    description:
      'Prints a versioned JSON description of this CLI and the MCP server for an agent that is about to drive it. Always JSON.',
    json: true,
  },
  {
    name: 'mcp-config',
    group: 'agents',
    summary: 'MCP server JSON for Claude, Cursor, Grok',
    usage: ['flowiq mcp-config'],
    description: 'Prints the stdio MCP server entry for this checkout. Always JSON.',
    json: true,
  },
  {
    name: 'setup',
    aliases: ['login', 'init'],
    group: 'setup',
    summary: 'choose a model provider, write MCP config',
    usage: ['flowiq setup', 'flowiq setup --provider P [--model M] [--write-mcp]'],
    description:
      'Interactive on a terminal. Without a terminal, pass --provider; nothing is written otherwise.',
    flags: [
      { name: '--provider', value: 'P', enum: PROVIDERS, summary: 'model provider' },
      { name: '--model', value: 'M', summary: 'model id' },
      { name: '--base-url', value: 'URL', summary: 'endpoint' },
      { name: '--write-mcp', summary: 'also write .mcp.json and .cursor/mcp.json' },
      { name: '--non-interactive', summary: 'use flags and defaults, ask nothing' },
    ],
  },
  {
    name: 'ui',
    aliases: ['open'],
    group: 'setup',
    summary: 'open the dashboard and field notebook',
    usage: ['flowiq ui [--no-open]'],
    description: 'Prints the local and live dashboard paths and opens them in a browser.',
    flags: [{ name: '--no-open', summary: 'print the paths only' }],
  },
  {
    name: 'stress',
    aliases: ['10x'],
    group: 'demo',
    summary: 'paraphrase and ambiguity suites',
    usage: ['flowiq stress'],
    description: 'Runs the blind paraphrase, ambiguity and 10x suites.',
    hidden: true,
  },
  {
    name: 'workflow',
    group: 'demo',
    summary: 'durable workflow simulation',
    usage: ['flowiq workflow'],
    description: 'Simulates a sharded durable workflow with a crash and replay.',
    hidden: true,
  },
  {
    name: 'swarm',
    group: 'demo',
    summary: 'parallel activity swarm simulation',
    usage: ['flowiq swarm'],
    description: 'Runs 40 of the 600 stored questions across 8 simulated workers.',
    hidden: true,
  },
  {
    name: 'help',
    group: 'setup',
    summary: 'help for a command',
    usage: ['flowiq help [command]'],
    description: 'Shows the overview, or one command in full.',
    hidden: true,
  },
  {
    name: 'version',
    group: 'setup',
    summary: 'print the version',
    usage: ['flowiq version [--json]'],
    description: 'Prints the CLI version.',
    json: true,
    hidden: true,
  },
];

export const KIT_ID_RE = /^(?:D0[1-9]|D10|T0[1-9]|T1[0-3]|B0[1-3]|EGGS)$/i;
export const KIT_ID_SHAPE_RE = /^[DTB]\d{2}$/i;

export function findCommand(name: string): CommandSpec | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find((c) => c.name === n || c.aliases?.includes(n));
}

export function commandNames(): string[] {
  return COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
}

/** Every flag a command accepts, global flags included. */
export function flagsFor(command: CommandSpec): FlagSpec[] {
  return [...GLOBAL_FLAGS, ...(command.flags ?? [])];
}
