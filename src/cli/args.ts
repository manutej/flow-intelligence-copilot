/**
 * Argument parsing against the command table. Every flag is checked
 * before anything runs: an unknown flag, a missing value, or a value
 * outside its enum is a usage error that names the fix.
 */
import { didYouMean } from '../util/suggest.ts';
import {
  type CommandSpec,
  COMMANDS,
  GLOBAL_FLAGS,
  KIT_ID_RE,
  commandNames,
  findCommand,
  flagsFor,
} from './commands.ts';

export class UsageError extends Error {
  readonly command?: string;
  constructor(message: string, command?: string) {
    super(message);
    this.name = 'UsageError';
    this.command = command;
  }
}

export interface ParsedArgs {
  /** The resolved command, or undefined for bare `flowiq`. */
  readonly command?: CommandSpec;
  readonly positionals: readonly string[];
  /** Flag name (long form) to value; `true` for a boolean flag. */
  readonly flags: ReadonlyMap<string, string | true>;
  /** `flowiq "<question>"` without the word ask. */
  readonly implicitAsk: boolean;
}

/** Old spellings that still work. */
const FLAG_ALIASES: Readonly<Record<string, string>> = { '--live-llm': '--llm' };

function canonicalFlag(raw: string, allowed: readonly { name: string; alias?: string }[]): string {
  const aliased = FLAG_ALIASES[raw] ?? raw;
  return allowed.find((f) => f.alias === aliased)?.name ?? aliased;
}

/** A word that is more likely a mistyped command than a question. */
function looksLikeCommand(word: string): boolean {
  return /^[a-z][\w:-]*$/i.test(word) && !KIT_ID_RE.test(word);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const firstPositional = argv.find((a) => !a.startsWith('-'));
  let command: CommandSpec | undefined;
  let implicitAsk = false;
  let rest = [...argv];

  if (firstPositional !== undefined) {
    const found = findCommand(firstPositional);
    if (found) {
      command = found;
      rest.splice(rest.indexOf(firstPositional), 1);
    } else if (argv.filter((a) => !a.startsWith('-')).length === 1 && looksLikeCommand(firstPositional)) {
      throw new UsageError(`unknown command "${firstPositional}"${didYouMean(firstPositional, commandNames())}`);
    } else {
      command = findCommand('ask');
      implicitAsk = true;
    }
  } else if (argv.some((a) => a === '--version' || a === '-V')) {
    command = findCommand('version');
  } else if (argv.length > 0 && !argv.every((a) => GLOBAL_FLAGS.some((g) => g.name === a || g.alias === a))) {
    // Flags with no words: ask flags with a missing question.
    command = findCommand('ask');
    implicitAsk = true;
  }

  const allowed = command ? flagsFor(command) : [...GLOBAL_FLAGS];
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const rawName = eq > 0 ? token.slice(0, eq) : token;
    const name = canonicalFlag(rawName, allowed);
    const spec = allowed.find((f) => f.name === name);
    if (!spec) {
      const where = command ? ` for ${command.name}` : '';
      throw new UsageError(
        `unknown flag ${rawName}${where}${didYouMean(rawName, allowed.map((f) => f.name))}`,
        command?.name,
      );
    }
    if (!spec.value) {
      if (eq > 0) throw new UsageError(`${name} takes no value`, command?.name);
      flags.set(name, true);
      continue;
    }
    let value: string | undefined;
    if (eq > 0) value = token.slice(eq + 1);
    else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) value = rest[(i += 1)];
    if (value === undefined || value === '') {
      throw new UsageError(`${name} needs a value (${spec.value})`, command?.name);
    }
    if (spec.enum && !spec.enum.includes(value)) {
      throw new UsageError(
        `${name} must be one of ${spec.enum.join(', ')} (got "${value}")${didYouMean(value, spec.enum)}`,
        command?.name,
      );
    }
    flags.set(name, value);
  }
  return { command, positionals, flags, implicitAsk };
}

/** A positive number or a usage error naming the flag. */
export function positiveNumber(flags: ReadonlyMap<string, string | true>, name: string): number | undefined {
  const raw = flags.get(name);
  if (raw === undefined || raw === true) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new UsageError(`${name} must be a number greater than 0 (got "${raw}")`);
  }
  return n;
}

export function stringFlag(flags: ReadonlyMap<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

export { COMMANDS };
