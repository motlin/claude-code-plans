/**
 * Fuzzy subsequence path matching for the Changes pane's Go to file (⌘P).
 * Every query character must appear in order in the path (case-insensitive).
 * Among all such alignments the best-scoring one wins: matches in the
 * basename, at word boundaries, and in contiguous runs score higher, and gaps
 * between matched characters cost a little.
 */

/** Half-open `[start, end)` character ranges into the path. */
export type MatchRange = readonly [start: number, end: number];

export interface PathMatch {
  score: number;
  ranges: MatchRange[];
}

const MATCH_SCORE = 16;
const BASENAME_BONUS = 8;
const BOUNDARY_BONUS = 8;
const CONSECUTIVE_BONUS = 12;
const GAP_PENALTY = 1;

const BOUNDARY_CHARS = new Set(["/", ".", "-", "_", " "]);

function charBonus(path: string, index: number, basenameStart: number): number {
  let bonus = MATCH_SCORE;
  if (index >= basenameStart) bonus += BASENAME_BONUS;
  const previous = index === 0 ? "/" : path.charAt(index - 1);
  const current = path.charAt(index);
  const camelHump = previous === previous.toLowerCase() && current !== current.toLowerCase();
  if (BOUNDARY_CHARS.has(previous) || camelHump) bonus += BOUNDARY_BONUS;
  return bonus;
}

function toRanges(indices: readonly number[]): MatchRange[] {
  const ranges: [number, number][] = [];
  for (const index of indices) {
    const last = ranges.at(-1);
    if (last !== undefined && last[1] === index) last[1] = index + 1;
    else ranges.push([index, index + 1]);
  }
  return ranges;
}

export function fuzzyMatchPath(query: string, path: string): PathMatch | null {
  const needle = query.toLowerCase();
  if (needle === "") return { score: 0, ranges: [] };
  const haystack = path.toLowerCase();
  const n = haystack.length;
  const m = needle.length;
  if (m > n) return null;

  const basenameStart = path.lastIndexOf("/") + 1;
  // score[i][j]: best score with needle[i] matched at haystack[j]; prev[i][j]: where needle[i-1] matched.
  const score: number[][] = [];
  const prev: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = Array.from<number>({ length: n }).fill(Number.NEGATIVE_INFINITY);
    const back = Array.from<number>({ length: n }).fill(-1);
    const above = score[i - 1];
    // Best of above[k] - gap(j - k - 1) over k <= j - 2, carried along j.
    let gapBest = Number.NEGATIVE_INFINITY;
    let gapFrom = -1;
    for (let j = i; j < n; j++) {
      if (above !== undefined && j >= 2) {
        const candidate = (above[j - 2] ?? Number.NEGATIVE_INFINITY) - GAP_PENALTY;
        gapBest -= GAP_PENALTY;
        if (candidate > gapBest) {
          gapBest = candidate;
          gapFrom = j - 2;
        }
      }
      if (haystack.charAt(j) !== needle.charAt(i)) continue;
      const bonus = charBonus(path, j, basenameStart);
      if (above === undefined) {
        row[j] = bonus;
        continue;
      }
      const adjacent =
        j >= 1 ? (above[j - 1] ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
      const viaAdjacent = adjacent + CONSECUTIVE_BONUS;
      if (viaAdjacent >= gapBest && viaAdjacent > Number.NEGATIVE_INFINITY) {
        row[j] = viaAdjacent + bonus;
        back[j] = j - 1;
      } else if (gapBest > Number.NEGATIVE_INFINITY) {
        row[j] = gapBest + bonus;
        back[j] = gapFrom;
      }
    }
    score.push(row);
    prev.push(back);
  }

  const last = score[m - 1] ?? [];
  let best = Number.NEGATIVE_INFINITY;
  let end = -1;
  for (let j = 0; j < n; j++) {
    const value = last[j] ?? Number.NEGATIVE_INFINITY;
    if (value > best) {
      best = value;
      end = j;
    }
  }
  if (end === -1) return null;

  const indices: number[] = [];
  for (let i = m - 1, j = end; i >= 0; i--) {
    indices.push(j);
    j = prev[i]?.[j] ?? -1;
  }
  indices.reverse();
  return { score: best, ranges: toRanges(indices) };
}

/** Go to file lists at most this many rows; the rest is summarized in the footer. */
export const GO_TO_FILE_LIMIT = 100;

export interface PathSearchResult extends PathMatch {
  path: string;
}

export interface PathSearch {
  results: PathSearchResult[];
  /** Matching paths left out by the cap. */
  more: number;
}

/**
 * Filter and rank paths for Go to file. An empty query keeps the given order;
 * otherwise best score first, then shorter paths, then original order.
 */
export function searchPaths(
  query: string,
  paths: readonly string[],
  limit: number = GO_TO_FILE_LIMIT,
): PathSearch {
  const matches: PathSearchResult[] = [];
  for (const path of paths) {
    const match = fuzzyMatchPath(query.trim(), path);
    if (match !== null) matches.push({ path, ...match });
  }
  if (query.trim() !== "") {
    matches.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  }
  return { results: matches.slice(0, limit), more: Math.max(0, matches.length - limit) };
}

export function goToFileFooter(more: number): string | null {
  if (more <= 0) return null;
  return `${more} more ${more === 1 ? "file" : "files"}. Keep typing to narrow.`;
}
