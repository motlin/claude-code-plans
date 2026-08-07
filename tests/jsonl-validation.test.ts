import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { JsonlRecordSchema } from "../src/lib/schemas";

/**
 * The default disk audit scans the 300 newest JSONL files changed in the last
 * two days. Run `FULL_JSONL_SCAN=1 just test tests/jsonl-validation.test.ts`
 * to validate the complete on-disk corpus during schema synchronization.
 */

const RECENT_WINDOW_MILLISECONDS = 2 * 24 * 60 * 60 * 1000;
const DEFAULT_FILE_LIMIT = 300;

interface JsonlFile {
  path: string;
  relativePath: string;
  modifiedAtMilliseconds: number;
}

interface FileSelection {
  files: JsonlFile[];
  skippedForAge: number;
  skippedForLimit: number;
}

function selectFilesForScan(
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

  const recentBoundary = currentTimeMilliseconds - RECENT_WINDOW_MILLISECONDS;
  const recentFiles = newestFirst.filter((file) => file.modifiedAtMilliseconds >= recentBoundary);
  return {
    files: recentFiles.slice(0, fileLimit),
    skippedForAge: newestFirst.length - recentFiles.length,
    skippedForLimit: Math.max(0, recentFiles.length - fileLimit),
  };
}

async function collectJsonlFiles(projectsDirectory: string): Promise<{
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
    let fileEntries;
    try {
      fileEntries = await readdir(projectPath, { withFileTypes: true });
    } catch {
      skippedUnavailablePaths++;
      continue;
    }

    const projectFiles: JsonlFile[] = [];
    await Promise.all(
      fileEntries.map(async (fileEntry) => {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith(".jsonl")) return;
        const filePath = join(projectPath, fileEntry.name);
        try {
          const fileStat = await stat(filePath);
          projectFiles.push({
            path: filePath,
            relativePath: join(projectEntry.name, fileEntry.name),
            modifiedAtMilliseconds: fileStat.mtimeMs,
          });
        } catch {
          skippedUnavailablePaths++;
        }
      }),
    );
    files.push(...projectFiles);
  }
  return { files, skippedUnavailablePaths };
}

async function validateFile(file: JsonlFile): Promise<{
  failures: string[];
  parsedLines: number;
  skippedUnparseableLines: number;
}> {
  const failures: string[] = [];
  let parsedLines = 0;
  let skippedUnparseableLines = 0;
  let lineNumber = 0;
  const lines = createInterface({
    input: createReadStream(file.path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();
    if (line === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedUnparseableLines++;
      continue;
    }

    parsedLines++;
    const result = JsonlRecordSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      failures.push(`${file.relativePath}:${lineNumber}\n${issues}`);
    }
  }

  return { failures, parsedLines, skippedUnparseableLines };
}

describe("JSONL disk scan selection", () => {
  const currentTimeMilliseconds = Date.parse("2000-01-03T00:00:00.000Z");
  const files: JsonlFile[] = [
    {
      path: "/tmp/test/alice-old.jsonl",
      relativePath: "alice/alice-old.jsonl",
      modifiedAtMilliseconds: Date.parse("1999-12-31T00:00:00.000Z"),
    },
    {
      path: "/tmp/test/bob-recent.jsonl",
      relativePath: "bob/bob-recent.jsonl",
      modifiedAtMilliseconds: Date.parse("2000-01-02T00:00:00.000Z"),
    },
    {
      path: "/tmp/test/alice-recent.jsonl",
      relativePath: "alice/alice-recent.jsonl",
      modifiedAtMilliseconds: Date.parse("2000-01-02T00:00:00.000Z"),
    },
    {
      path: "/tmp/test/charlie-newest.jsonl",
      relativePath: "charlie/charlie-newest.jsonl",
      modifiedAtMilliseconds: Date.parse("2000-01-03T00:00:00.000Z"),
    },
  ];

  it("selects recent files newest-first with a deterministic path tie-break and cap", () => {
    expect(selectFilesForScan(files, false, currentTimeMilliseconds, 2)).toStrictEqual({
      files: [files[3], files[2]],
      skippedForAge: 1,
      skippedForLimit: 1,
    });
  });

  it("selects every file newest-first for a full scan", () => {
    expect(selectFilesForScan(files, true, currentTimeMilliseconds, 2)).toStrictEqual({
      files: [files[3], files[2], files[1], files[0]],
      skippedForAge: 0,
      skippedForLimit: 0,
    });
  });
});

describe("JsonlRecordSchema against disk", () => {
  const projectsDirectory = join(homedir(), ".claude", "projects");

  it("validates the selected JSONL corpus with bounded memory", async () => {
    const fullScan = process.env["FULL_JSONL_SCAN"] === "1";
    const collected = await collectJsonlFiles(projectsDirectory);
    const selection = selectFilesForScan(collected.files, fullScan, Date.now(), DEFAULT_FILE_LIMIT);
    const failures: string[] = [];
    let parsedLines = 0;
    let skippedUnparseableLines = 0;
    let skippedUnavailableFiles = 0;

    for (const file of selection.files) {
      try {
        const validation = await validateFile(file);
        failures.push(...validation.failures);
        parsedLines += validation.parsedLines;
        skippedUnparseableLines += validation.skippedUnparseableLines;
      } catch {
        skippedUnavailableFiles++;
      }
    }

    console.log(
      [
        `Scanned ${selection.files.length - skippedUnavailableFiles} files and ${parsedLines} lines`,
        `skipped ${selection.skippedForAge} stale files`,
        `${selection.skippedForLimit} files over the cap`,
        `${collected.skippedUnavailablePaths + skippedUnavailableFiles} unavailable paths`,
        `and ${skippedUnparseableLines} unparseable lines`,
        `mode=${fullScan ? "full" : "recent"}`,
      ].join("; "),
    );

    if (failures.length > 0) {
      const uniquePatterns = new Map<string, string>();
      for (const failure of failures) {
        const issueLines = failure.split("\n").slice(1).join("\n");
        if (!uniquePatterns.has(issueLines)) {
          uniquePatterns.set(issueLines, failure);
        }
      }

      const sample = [...uniquePatterns.values()].slice(0, 50);
      throw new Error(
        `${failures.length} lines failed validation (${uniquePatterns.size} unique patterns):\n\n${sample.join("\n\n")}`,
      );
    }
  }, 120000);
});
