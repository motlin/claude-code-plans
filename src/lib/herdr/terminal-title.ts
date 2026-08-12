export type TerminalTitleParts = {
  glyph: string | null;
  title: string;
};

const LEADING_GLYPH = /^([^\p{L}\p{N}\s])\s+(.+)$/u;

/**
 * Herdr prefixes terminal titles with a status glyph ("✳ Teammate availability
 * notification", "✓ kalshi", "$ claude-code-plugins"). Splitting it off lets the
 * fleet list render the glyph in its own fixed-width column so every title
 * starts at the same x position.
 */
export function splitTerminalTitleGlyph(displayName: string): TerminalTitleParts {
  const match = LEADING_GLYPH.exec(displayName);
  const glyph = match?.[1];
  const title = match?.[2];
  if (glyph === undefined || title === undefined) return { glyph: null, title: displayName };
  return { glyph, title };
}
