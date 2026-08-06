import type { z } from "zod";
import type { FindingSchema } from "./api/reviews";

export type ReviewFinding = z.infer<typeof FindingSchema>;

export interface ReviewDiffLine {
  content: string;
  oldLine: number | null;
  newLine: number | null;
  prefix: " " | "+" | "-";
}

export interface ReviewDiffFile {
  file: string;
  header: string[];
  lines: ReviewDiffLine[];
}

function unprefixedPath(value: string): string {
  if (value === "/dev/null") return value;
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}

export function parseReviewDiff(diff: string): ReviewDiffFile[] {
  const files: ReviewDiffFile[] = [];
  let current: ReviewDiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const path = rawLine.match(/^diff --git a\/(.+) b\/(.+)$/)?.[2] ?? "unknown";
      current = { file: path, header: [rawLine], lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (current === null) continue;
    if (rawLine.startsWith("+++ ")) {
      const path = unprefixedPath(rawLine.slice(4));
      if (path !== "/dev/null") current.file = path;
      current.header.push(rawLine);
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      current.header.push(rawLine);
      continue;
    }
    if (rawLine.startsWith("@@ ")) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) throw new Error(`Invalid unified diff hunk: ${rawLine}`);
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      current.header.push(rawLine);
      inHunk = true;
      continue;
    }
    if (!inHunk || rawLine === "\\ No newline at end of file") {
      if (rawLine !== "") current.header.push(rawLine);
      continue;
    }

    const prefix = rawLine[0];
    const content = rawLine.slice(1);
    if (prefix === "+") {
      current.lines.push({ content, oldLine: null, newLine, prefix });
      newLine++;
    } else if (prefix === "-") {
      current.lines.push({ content, oldLine, newLine: null, prefix });
      oldLine++;
    } else if (prefix === " ") {
      current.lines.push({ content, oldLine, newLine, prefix });
      oldLine++;
      newLine++;
    }
  }

  return files;
}

export function findingsForDiffLine(
  findings: ReviewFinding[],
  file: string,
  line: ReviewDiffLine,
): ReviewFinding[] {
  return findings.filter((finding) => {
    if (finding.file !== file) return false;
    const addressedLine = finding.side === "old" ? line.oldLine : line.newLine;
    if (addressedLine === null) return false;
    return addressedLine >= finding.line && addressedLine <= (finding.endLine ?? finding.line);
  });
}
