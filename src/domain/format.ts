/**
 * The one place prose formats money, counts, and wrapped text.
 * Answers are copied into spreadsheets and emails, so formatting may add
 * a `$` and thousands separators but must never change the digits.
 */

/** `84560` -> `$84,560.00`; with `trimCents`, `199880` -> `$199,880`. */
export function fmtUsd(usd: number, opts: { trimCents?: boolean } = {}): string {
  const sign = usd < 0 ? '-' : '';
  const body = Math.abs(usd).toLocaleString('en-US', {
    minimumFractionDigits: opts.trimCents ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

/** `plural(1, 'signed lease')` -> `1 signed lease`; `plural(2, ...)` -> `2 signed leases`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Wrap text to `width` columns for a terminal without changing it.
 * A word longer than the width (compact JSON, a long citation list) is
 * broken after `,` `:` `}` `]` or hard-cut, and the pieces are marked as
 * continuations, so `unwrapLines(wrapLines(t, w))` equals `t` with its
 * whitespace collapsed. Nothing is inserted into the data, so
 * `$84,560.00` never becomes `$84, 560.00`.
 */
export interface WrappedLine {
  text: string;
  /** True when this line continues the previous line's last word. */
  continuation: boolean;
}

export function wrapLines(text: string, width: number): WrappedLine[] {
  const w = Math.max(8, width);
  const pieces: Array<{ text: string; glued: boolean }> = [];
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (word.length <= w) {
      pieces.push({ text: word, glued: false });
      continue;
    }
    const parts = word.split(/(?<=[,:}\]])/).filter(Boolean);
    let first = true;
    for (const part of parts) {
      for (let i = 0; i < part.length; i += w) {
        pieces.push({ text: part.slice(i, i + w), glued: !first });
        first = false;
      }
    }
  }
  const lines: WrappedLine[] = [];
  let cur: WrappedLine | null = null;
  for (const piece of pieces) {
    const joiner = piece.glued ? '' : ' ';
    if (cur && cur.text.length + joiner.length + piece.text.length <= w) {
      cur.text += joiner + piece.text;
    } else {
      if (cur) lines.push(cur);
      cur = { text: piece.text, continuation: piece.glued };
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [{ text: '', continuation: false }];
}

export function wrapText(text: string, width: number): string[] {
  return wrapLines(text, width).map((l) => l.text);
}

export function unwrapLines(lines: WrappedLine[]): string {
  return lines.map((l, i) => (i === 0 || l.continuation ? l.text : ` ${l.text}`)).join('');
}

/** Print `prefix` + wrapped body, indenting continuation lines under the body. */
export function printWrapped(prefix: string, body: string, totalWidth = 72): void {
  const pad = ' '.repeat(prefix.length);
  const lines = wrapText(body, Math.max(28, totalWidth - prefix.length));
  console.log(`${prefix}${lines[0]}`);
  for (let i = 1; i < lines.length; i += 1) console.log(`${pad}${lines[i]}`);
}
