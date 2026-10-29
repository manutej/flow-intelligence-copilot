/**
 * The FlowIQ wordmark: plain ASCII so it survives any terminal, a pasted
 * log, and an MCP client that shows tool text in a code block. The CLI
 * colours it gold on a terminal; the MCP `flowiq_about` tool sends it as
 * is. It is 45 columns wide, so it fits a 60-column window.
 */
export const WORDMARK: readonly string[] = [
  ' ___   _       ___   __      __  ___    ___',
  '| __| | |     / _ \\  \\ \\    / / |_ _|  / _ \\',
  '| _|  | |__  | (_) |  \\ \\/\\/ /   | |  | (_) |',
  '|_|   |____|  \\___/    \\_/\\_/   |___|  \\__\\_\\',
];

/** The line under the wordmark, in the Ormus mono-label voice. */
export const WORDMARK_TAGLINE = '/ ORMUS  PORTFOLIO COPILOT';

/** One line for windows too narrow for the wordmark. */
export const WORDMARK_NARROW = 'FLOWIQ / ORMUS PORTFOLIO COPILOT';

export const WORDMARK_WIDTH = Math.max(...WORDMARK.map((l) => l.length));

/** The wordmark and tagline as one plain block, for MCP text and logs. */
export function plainWordmark(version: string): string {
  const tag = `${WORDMARK_TAGLINE}  v${version}`;
  return [...WORDMARK, '', tag].join('\n');
}
