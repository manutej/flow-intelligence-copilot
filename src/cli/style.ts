/**
 * Terminal style for every FlowIQ surface, in the Ormus Chrome palette:
 * gold is the only accent, text is ink or muted ink, rules are hairlines,
 * labels read "/ NAME", status is a word, and nothing is an emoji.
 *
 * Colour is on only for a terminal that wants it: off under --no-color,
 * NO_COLOR (any non-empty value, per no-color.org), TERM=dumb, or when
 * stdout is not a TTY; FORCE_COLOR turns it back on for recordings.
 * Lines never pass 80 columns, and wrapping never inserts characters.
 */
import { wrapLines } from '../domain/format.ts';
import { WORDMARK, WORDMARK_NARROW, WORDMARK_TAGLINE, WORDMARK_WIDTH } from './wordmark.ts';

interface StreamLike {
  readonly isTTY?: boolean;
  readonly columns?: number;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Hex tokens from Ormus Fusion, flattened onto the midnight ground. */
const TOKENS = {
  gold: [210, 158, 61],
  goldBright: [224, 178, 88],
  ink: [236, 234, 227],
  inkMuted: [165, 176, 196],
  muted: [109, 120, 145],
  // ormus-hairline (ink at 12% alpha) over ormus-midnight
  hairline: [46, 57, 81],
  danger: [212, 79, 79],
} as const;

export const MAX_WIDTH = 80;
const MIN_WIDTH = 40;

export function colorEnabled(stream: StreamLike, env: Env, noColorFlag = false): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return stream.isTTY === true;
}

export function terminalWidth(stream: StreamLike): number {
  if (stream.isTTY !== true || !stream.columns) return MAX_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stream.columns));
}

export interface Style {
  readonly color: boolean;
  /** True when stdout is a terminal (the banner shows only there). */
  readonly tty: boolean;
  readonly width: number;
  gold(s: string): string;
  goldBright(s: string): string;
  ink(s: string): string;
  strong(s: string): string;
  muted(s: string): string;
  dim(s: string): string;
  danger(s: string): string;
  /** A full-width hairline rule. */
  rule(): string;
  /** A "/ NAME" micro-label; `lead` makes it the surface's one gold label. */
  label(name: string, lead?: boolean): string;
  /**
   * A labelled field: the label in a fixed column, the body wrapped under
   * itself. Returns the lines so callers can print or test them.
   */
  field(name: string, body: string, paint?: (s: string) => string, labelWidth?: number): string[];
  /** Indented key and value rows, value wrapped under itself. */
  row(key: string, value: string, keyWidth?: number, paint?: (s: string) => string): string[];
  /** Plain wrapped paragraph with a left indent. */
  para(text: string, indent?: number, paint?: (s: string) => string): string[];
  /** The wordmark banner, or one line when the window is too narrow. */
  banner(version: string): string[];
}

function sgr(color: boolean, rgb: readonly number[], bold = false): (s: string) => string {
  if (!color) return (s) => s;
  const open = `\x1b[${bold ? '1;' : ''}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return (s) => (s ? `${open}${s}\x1b[0m` : s);
}

export function createStyle(opts: {
  stream?: StreamLike;
  env?: Env;
  noColor?: boolean;
} = {}): Style {
  const stream = opts.stream ?? process.stdout;
  const env = opts.env ?? process.env;
  const color = colorEnabled(stream, env, opts.noColor);
  const width = terminalWidth(stream);
  const gold = sgr(color, TOKENS.gold);
  const goldBright = sgr(color, TOKENS.goldBright);
  const ink = sgr(color, TOKENS.ink);
  const strong = sgr(color, TOKENS.ink, true);
  const muted = sgr(color, TOKENS.inkMuted);
  const dim = sgr(color, TOKENS.muted);
  const hair = sgr(color, TOKENS.hairline);
  const danger = sgr(color, TOKENS.danger, true);

  const wrapped = (text: string, w: number): string[] => wrapLines(text, w).map((l) => l.text);

  return {
    color,
    tty: stream.isTTY === true,
    width,
    gold,
    goldBright,
    ink,
    strong,
    muted,
    dim,
    danger,
    rule: () => hair('─'.repeat(width)),
    label: (name, lead = false) => (lead ? gold : muted)(`/ ${name.toUpperCase()}`),
    field(name, body, paint = ink, labelWidth = 12) {
      const head = (name ? `/ ${name.toUpperCase()}` : '').padEnd(labelWidth);
      const pad = ' '.repeat(labelWidth);
      return wrapped(body, width - labelWidth).map(
        (line, i) => `${i === 0 ? muted(head) : pad}${paint(line)}`,
      );
    },
    row(key, value, keyWidth = 18, paint = ink) {
      const pad = ' '.repeat(keyWidth + 2);
      const body = wrapped(value, width - keyWidth - 2).map((line) => `${pad}${paint(line)}`);
      if (key.length >= keyWidth) return [`  ${muted(key)}`, ...body];
      body[0] = `${muted(`  ${key}`.padEnd(keyWidth + 2))}${body[0].slice(pad.length)}`;
      return body;
    },
    para(text, indent = 2, paint = ink) {
      const pad = ' '.repeat(indent);
      return wrapped(text, width - indent).map((line) => `${pad}${paint(line)}`);
    },
    banner(version) {
      const tag = WORDMARK_TAGLINE;
      const ver = `v${version}`;
      if (width < WORDMARK_WIDTH + 4) {
        return [`${gold(WORDMARK_NARROW)}  ${dim(ver)}`, hair('─'.repeat(width))];
      }
      const gap = Math.max(2, width - 2 - tag.length - ver.length);
      return [
        '',
        ...WORDMARK.map((line) => `  ${gold(line)}`),
        '',
        `  ${muted(tag)}${' '.repeat(gap)}${dim(ver)}`,
        hair('─'.repeat(width)),
      ];
    },
  };
}

/** Visible length, ignoring colour codes. */
export function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}
