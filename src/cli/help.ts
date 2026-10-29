/**
 * Help text for the overview and for each command, drawn from the
 * command table. The banner shows only on a terminal; piped help is the
 * same text without it, so `flowiq --help | grep` stays useful.
 */
import { wrapText } from '../domain/format.ts';
import { FLOWIQ_VERSION } from '../version.ts';
import { type CommandSpec, COMMANDS, EXIT_CODE_DOCS, GLOBAL_FLAGS, type FlagSpec } from './commands.ts';
import type { Style } from './style.ts';

const GROUPS: ReadonlyArray<{ id: CommandSpec['group']; title: string }> = [
  { id: 'ask', title: 'Ask' },
  { id: 'data', title: 'Data' },
  { id: 'agents', title: 'Agents' },
  { id: 'setup', title: 'Setup' },
];

function flagUsage(f: FlagSpec): string {
  const alias = f.alias ? `${f.alias}, ` : '';
  return `${alias}${f.name}${f.value ? ` ${f.value}` : ''}`;
}

/** Two columns: a fixed-width left cell, the right cell wrapped under itself. */
function twoCol(s: Style, left: string, right: string, leftWidth: number, paintLeft = s.ink): string[] {
  const pad = '  ';
  const hang = ' '.repeat(leftWidth);
  const body = right ? wrapText(right, s.width - pad.length - leftWidth) : [''];
  if (left.length >= leftWidth) {
    return [`${pad}${paintLeft(left)}`, ...(right ? body.map((l) => `${pad}${hang}${s.muted(l)}`) : [])];
  }
  return body.map((l, i) =>
    `${pad}${i === 0 ? paintLeft(left.padEnd(leftWidth)) : hang}${s.muted(l)}`.trimEnd(),
  );
}

export function renderMainHelp(s: Style, opts: { banner: boolean }): string[] {
  const lines: string[] = [];
  if (opts.banner) lines.push(...s.banner(FLOWIQ_VERSION));
  else lines.push(`${s.label('FlowIQ')}  ${s.dim(`v${FLOWIQ_VERSION}`)}`, s.rule());
  lines.push(...s.para('Answers about the apartment portfolio from six CSV exports, with the source rows for every number.', 2));
  lines.push('', s.label('Usage'));
  lines.push(...twoCol(s, 'flowiq <command> [flags]', '', 26));
  lines.push(...twoCol(s, 'flowiq "<question>"', 'same as flowiq ask', 26));
  for (const g of GROUPS) {
    const cmds = COMMANDS.filter((c) => c.group === g.id && !c.hidden);
    if (cmds.length === 0) continue;
    lines.push('', s.label(g.title));
    for (const c of cmds) {
      const left = c.name === 'ask' ? 'ask "<question>" | <ID>' : c.name === 'validate' ? 'validate [ID]' : c.name;
      lines.push(...twoCol(s, left, c.summary, 26));
    }
  }
  lines.push('', s.label('Global flags'));
  for (const f of GLOBAL_FLAGS) lines.push(...twoCol(s, flagUsage(f), f.summary, 26));
  lines.push('', s.label('Exit codes'));
  lines.push(`  ${s.muted(EXIT_CODE_DOCS.map((e) => `${e.code} ${shortExit(e.code)}`).join('   '))}`);
  lines.push('', ...s.para('flowiq help <command> for flags and examples. flowiq agent-context prints all of this as JSON.', 2, s.dim));
  return lines;
}

function shortExit(code: number): string {
  switch (code) {
    case 0: return 'ok';
    case 1: return 'check failed';
    case 2: return 'usage';
    case 3: return 'not found';
    case 10: return 'no data';
    case 130: return 'cancelled';
    default: return '';
  }
}

export function renderCommandHelp(s: Style, c: CommandSpec): string[] {
  const lines: string[] = [`${s.label(`FlowIQ ${c.name}`)}  ${s.dim(c.summary)}`, s.rule()];
  lines.push(...s.para(c.description, 2));
  lines.push('', s.label('Usage'));
  for (const u of c.usage) lines.push(`  ${s.ink(u)}`);
  if (c.aliases?.length) lines.push(`  ${s.dim(`also: ${c.aliases.join(', ')}`)}`);
  const flags = c.flags ?? [];
  if (flags.length > 0) {
    lines.push('', s.label('Flags'));
    for (const f of flags) {
      const values = f.enum ? ` (${f.enum.join(' | ')})` : '';
      lines.push(...twoCol(s, flagUsage(f), `${f.summary}${values}`, 22));
    }
  }
  lines.push('', s.label('Global flags'));
  lines.push(`  ${s.muted(GLOBAL_FLAGS.map(flagUsage).join('   '))}`);
  if (c.examples?.length) {
    lines.push('', s.label('Examples'));
    for (const e of c.examples) lines.push(`  ${s.ink(e)}`);
  }
  return lines;
}
