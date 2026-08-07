import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Enumeration and selection of the on-disk JSONL corpus under `~/.claude/projects`.
 *
 * The corpus has two tiers: `<project>/<sessionId>.jsonl` transcripts and the
 * `<project>/<sessionId>/subagents/agent-*.jsonl` transcripts spawned from them.
 * Subagent files outnumber session files roughly four to one, and the viewer
 * parses both with `JsonlRecordSchema`, so both tiers must be validated.
 */

export interface JsonlFile {
  path: string;
  relativePath: string;
  modifiedAtMilliseconds: number;
}

export interface FileSelection {
  files: JsonlFile[];
  skippedForAge: number;
  skippedForLimit: number;
}

export function selectFilesForScan(
  files: JsonlFile[],
  fullScan: boolean,
  currentTimeMilliseconds: number,
  fileLimit: number,
): FileSelection {
  const newestFirst = [...files].sort(
    (left, right) =>
      right.modifiedAtMilliseconds - left.modifiedAtMilliseconds ||
      left.relativePath.localeCompare(right.relativePath),
  );
  if (fullScan) {
    return { files: newestFirst, skippedForAge: 0, skippedForLimit: 0 };
  }

  const recentWindowMilliseconds = 2 * 24 * 60 * 60 * 1000;
  const recentBoundary = currentTimeMilliseconds - recentWindowMilliseconds;
  const recentFiles = newestFirst.filter((file) => file.modifiedAtMilliseconds >= recentBoundary);
  return {
    files: recentFiles.slice(0, fileLimit),
    skippedForAge: newestFirst.length - recentFiles.length,
    skippedForLimit: Math.max(0, recentFiles.length - fileLimit),
  };
}

/**
 * Tool-input issues come from the `ContentBlockSchema` refinement, which
 * re-paths them under `message.content.<n>.input`. They mean the model emitted
 * a malformed tool call — a fact about the recorded conversation, not evidence
 * that our schema is behind. Record-shape issues are the ones that mean drift.
 */
export function partitionIssues(issues: readonly { path: PropertyKey[]; message: string }[]): {
  recordIssues: string[];
  toolInputIssues: string[];
} {
  const recordIssues: string[] = [];
  const toolInputIssues: string[] = [];
  for (const issue of issues) {
    const path = issue.path.map(String);
    const formatted = path.length > 0 ? `${path.join(".")}: ${issue.message}` : issue.message;
    const isToolInput =
      path.length >= 4 &&
      path[0] === "message" &&
      path[1] === "content" &&
      /^\d+$/.test(path[2] ?? "") &&
      path[3] === "input";
    if (isToolInput) {
      toolInputIssues.push(formatted);
    } else {
      recordIssues.push(formatted);
    }
  }
  return { recordIssues, toolInputIssues };
}

async function statJsonlFiles(
  directory: string,
  relativeDirectory: string,
): Promise<{ files: JsonlFile[]; skippedUnavailablePaths: number }> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { files: [], skippedUnavailablePaths: 0 };
  }

  const files: JsonlFile[] = [];
  let skippedUnavailablePaths = 0;
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
      const filePath = join(directory, entry.name);
      try {
        const fileStat = await stat(filePath);
        files.push({
          path: filePath,
          relativePath: join(relativeDirectory, entry.name),
          modifiedAtMilliseconds: fileStat.mtimeMs,
        });
      } catch {
        skippedUnavailablePaths++;
      }
    }),
  );
  return { files, skippedUnavailablePaths };
}

export async function collectJsonlFiles(projectsDirectory: string): Promise<{
  files: JsonlFile[];
  skippedUnavailablePaths: number;
}> {
  let projectEntries;
  try {
    projectEntries = await readdir(projectsDirectory, { withFileTypes: true });
  } catch {
    return { files: [], skippedUnavailablePaths: 0 };
  }

  const files: JsonlFile[] = [];
  let skippedUnavailablePaths = 0;
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectPath = join(projectsDirectory, projectEntry.name);

    const sessionFiles = await statJsonlFiles(projectPath, projectEntry.name);
    files.push(...sessionFiles.files);
    skippedUnavailablePaths += sessionFiles.skippedUnavailablePaths;

    let sessionEntries;
    try {
      sessionEntries = await readdir(projectPath, { withFileTypes: true });
    } catch {
      skippedUnavailablePaths++;
      continue;
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;
      const subagentFiles = await statJsonlFiles(
        join(projectPath, sessionEntry.name, "subagents"),
        join(projectEntry.name, sessionEntry.name, "subagents"),
      );
      files.push(...subagentFiles.files);
      skippedUnavailablePaths += subagentFiles.skippedUnavailablePaths;
    }
  }
  return { files, skippedUnavailablePaths };
}
