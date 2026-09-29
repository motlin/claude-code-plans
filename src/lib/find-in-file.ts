export interface FindRange {
  start: number;
  end: number;
}

function findPattern(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const caseSensitive = query !== query.toLowerCase();
  return new RegExp(escaped, caseSensitive ? "gu" : "giu");
}

/**
 * Every non-overlapping occurrence of `query` in `text`, as UTF-16 offsets.
 * Smart-case: an all-lowercase query ignores case, any uppercase letter makes
 * the match exact.
 */
export function findMatches(text: string, query: string): FindRange[] {
  if (query === "") return [];
  return [...text.matchAll(findPattern(query))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/**
 * The global index of each line's first match, so a mounted source row can
 * number its matches without the rest of the file being in the DOM.
 */
export function lineMatchOffsets(
  content: string,
  query: string,
): { offsets: number[]; total: number } {
  const offsets: number[] = [];
  let total = 0;
  for (const line of content.split("\n")) {
    offsets.push(total);
    total += findMatches(line, query).length;
  }
  return { offsets, total };
}

/** The find bar counter for the zero-based `active` match. */
export function findCounterText(active: number, total: number): string {
  return total === 0 ? "No results" : `${active + 1} of ${total}`;
}

/** The next (1) or previous (-1) match index, wrapping around. */
export function stepMatch(active: number, total: number, direction: 1 | -1): number {
  if (total === 0) return 0;
  return (active + direction + total) % total;
}

/** The one-based line holding match `index`, given `lineMatchOffsets` offsets. */
export function lineOfMatch(offsets: readonly number[], index: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((offsets[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** The first match on or after one-based `line`, wrapping to the first match. */
export function firstMatchFromLine(
  { offsets, total }: { offsets: readonly number[]; total: number },
  line: number,
): number {
  const offset = offsets[line - 1];
  return offset === undefined || offset >= total ? 0 : offset;
}
