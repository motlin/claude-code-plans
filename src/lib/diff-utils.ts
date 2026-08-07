/**
 * Pure utility functions for diff computation, language detection, and
 * line-number extraction. These are safe to import from client-side code
 * (no Shiki, no MarkdownIt, no Node.js dependencies).
 */

type DiffOp = readonly ["equal", string] | readonly ["remove", string] | readonly ["add", string];

interface DiffData {
  ops: DiffOp[];
  added: number;
  removed: number;
  unifiedHunk?: string | undefined;
  oldContent?: string | undefined;
  newContent?: string | undefined;
  filePath?: string | undefined;
}

const MAX_LCS_MATRIX_CELLS = 250_000;

function computeDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  let prefixLength = 0;
  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldLines.length - prefixLength &&
    suffixLength < newLines.length - prefixLength &&
    oldLines[oldLines.length - suffixLength - 1] === newLines[newLines.length - suffixLength - 1]
  ) {
    suffixLength++;
  }

  const oldMiddle = oldLines.slice(prefixLength, oldLines.length - suffixLength);
  const newMiddle = newLines.slice(prefixLength, newLines.length - suffixLength);
  const prefix = oldLines.slice(0, prefixLength).map((line) => ["equal", line] as const);
  const suffix = oldLines
    .slice(oldLines.length - suffixLength)
    .map((line) => ["equal", line] as const);

  if ((oldMiddle.length + 1) * (newMiddle.length + 1) > MAX_LCS_MATRIX_CELLS) {
    return [
      ...prefix,
      ...oldMiddle.map((line) => ["remove", line] as const),
      ...newMiddle.map((line) => ["add", line] as const),
      ...suffix,
    ];
  }

  const m = oldMiddle.length;
  const n = newMiddle.length;

  // LCS via dynamic programming
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldMiddle[i - 1] === newMiddle[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to produce diff ops
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldMiddle[i - 1] === newMiddle[j - 1]) {
      ops.push(["equal", oldMiddle[i - 1]!]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push(["add", newMiddle[j - 1]!]);
      j--;
    } else {
      ops.push(["remove", oldMiddle[i - 1]!]);
      i--;
    }
  }
  ops.reverse();
  return [...prefix, ...ops, ...suffix];
}

export function computeDiffData(oldStr: string, newStr: string): DiffData {
  const ops = computeDiff(oldStr.split("\n"), newStr.split("\n"));
  let added = 0;
  let removed = 0;
  for (const [type] of ops) {
    if (type === "add") added++;
    else if (type === "remove") removed++;
  }
  return { ops, added, removed };
}

/**
 * Split diff input into lines, treating the empty string as zero lines rather
 * than one empty line. `"".split("\n")` yields `[""]`, which would claim a side
 * has a single blank line; @git-diff-view/core then cross-checks that phantom
 * line against the (genuinely empty) file content and logs a mismatch warning.
 */
function splitDiffLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/**
 * Synthesize a complete unified diff string from the Edit tool's
 * `old_string` / `new_string` fragments, in the format @git-diff-view/core
 * expects (git-style header + hunks). Line numbers are relative to the
 * fragment (starting at 1) -- not the surrounding file -- because the tool
 * payload doesn't capture the full-file context.
 *
 * An empty side uses git's `0,0` convention (as for file creation, which is how
 * the Write tool renders), since a missing side starts at line 0, not line 1.
 */
export function buildUnifiedHunk(oldStr: string, newStr: string, filePath = "file"): string {
  const oldLines = splitDiffLines(oldStr);
  const newLines = splitDiffLines(newStr);
  const ops = computeDiff(oldLines, newLines);

  const body: string[] = [];
  for (const [type, line] of ops) {
    if (type === "equal") body.push(" " + line);
    else if (type === "add") body.push("+" + line);
    else body.push("-" + line);
  }

  const oldStart = oldLines.length === 0 ? 0 : 1;
  const newStart = newLines.length === 0 ? 0 : 1;

  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
    ...body,
  ].join("\n");
}

/**
 * Extracts line numbers from Read tool prefixes (e.g., "1→content" -> {content: "content", lineNumber: 1})
 * and removes the prefix from the line.
 * Returns {text, startLine, hasLineNumbers} where:
 * - text: the code without line number prefixes
 * - startLine: the starting line number (or 1 if not found)
 * - hasLineNumbers: whether line numbers were detected in the original text
 */
export function extractLineNumbers(text: string): {
  text: string;
  startLine: number;
  hasLineNumbers: boolean;
} {
  const lines = text.split("\n");
  let startLine = 1;
  let hasLineNumbers = false;

  const processedLines = lines.map((line, index) => {
    // Match line number prefix patterns: "  1→" or "1→" or "1\t"
    const match = line.match(/^\s*(\d+)[→\t]/);
    if (match) {
      hasLineNumbers = true;
      if (index === 0) {
        startLine = parseInt(match[1]!, 10);
      }
      // Remove the prefix and preserve the rest of the line
      return line.replace(/^\s*\d+[→\t]/, "");
    }
    return line;
  });

  return {
    text: processedLines.join("\n"),
    startLine: hasLineNumbers ? startLine : 1,
    hasLineNumbers,
  };
}

/**
 * Map from file extension (without leading dot) to Shiki language identifier.
 * Only includes languages commonly seen in Claude Code tool results.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  jsonc: "jsonc",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  // md/mdx intentionally excluded: Shiki's markdown grammar tokenizes
  // checkbox syntax (- [x]) and inline markers oddly, splitting characters.
  // Plain text rendering is more readable for raw markdown source.
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  lua: "lua",
  r: "r",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  zig: "zig",
  elixir: "elixir",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hcl: "hcl",
  tf: "hcl",
  ini: "ini",
  conf: "ini",
  env: "dotenv",
};

/**
 * Detect a Shiki language identifier from a file path.
 * Returns null when the extension is unrecognized.
 */
export function detectLanguage(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return null;
  const extension = filePath.slice(lastDot + 1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[extension] ?? null;
}
