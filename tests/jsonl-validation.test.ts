import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { JsonlRecordSchema } from "../src/lib/schemas";
import {
  collectJsonlFiles,
  partitionIssues,
  selectFilesForScan,
  type JsonlFile,
} from "./jsonl-corpus";

/**
 * The default disk audit scans the 300 newest JSONL files changed in the last
 * two days, drawn from both session transcripts and the subagent transcripts
 * nested beneath them. Run
 * `FULL_JSONL_SCAN=1 just test tests/jsonl-validation.test.ts` to validate
 * every JSONL file on disk during schema synchronization.
 *
 * Only record-shape mismatches fail the audit; those mean the schemas are
 * behind what Claude Code writes. Malformed tool inputs are counted and
 * reported instead, because they record a bad call the model made and no
 * schema change can make them correct.
 */

const DEFAULT_FILE_LIMIT = 300;

async function validateFile(file: JsonlFile): Promise<{
  failures: string[];
  toolInputMismatches: number;
  parsedLines: number;
  skippedUnparseableLines: number;
}> {
  const failures: string[] = [];
  let toolInputMismatches = 0;
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
    if (result.success) continue;

    const { recordIssues, toolInputIssues } = partitionIssues(result.error.issues);
    if (toolInputIssues.length > 0) toolInputMismatches++;
    if (recordIssues.length > 0) {
      const issues = recordIssues.map((issue) => `  ${issue}`).join("\n");
      failures.push(`${file.relativePath}:${lineNumber}\n${issues}`);
    }
  }

  return { failures, toolInputMismatches, parsedLines, skippedUnparseableLines };
}

describe("JsonlRecordSchema against disk", () => {
  const projectsDirectory = join(homedir(), ".claude", "projects");

  it("validates the selected JSONL corpus with bounded memory", async () => {
    const fullScan = process.env["FULL_JSONL_SCAN"] === "1";
    const collected = await collectJsonlFiles(projectsDirectory);
    const selection = selectFilesForScan(collected.files, fullScan, Date.now(), DEFAULT_FILE_LIMIT);
    const failures: string[] = [];
    let toolInputMismatches = 0;
    let parsedLines = 0;
    let skippedUnparseableLines = 0;
    let skippedUnavailableFiles = 0;

    for (const file of selection.files) {
      try {
        const validation = await validateFile(file);
        failures.push(...validation.failures);
        toolInputMismatches += validation.toolInputMismatches;
        parsedLines += validation.parsedLines;
        skippedUnparseableLines += validation.skippedUnparseableLines;
      } catch {
        skippedUnavailableFiles++;
      }
    }

    const summary = [
      `Scanned ${selection.files.length - skippedUnavailableFiles} files and ${parsedLines} lines`,
      `skipped ${selection.skippedForAge} stale files`,
      `${selection.skippedForLimit} files over the cap`,
      `${collected.skippedUnavailablePaths + skippedUnavailableFiles} unavailable paths`,
      `${skippedUnparseableLines} unparseable lines`,
      `and ${toolInputMismatches} malformed tool inputs`,
      `mode=${fullScan ? "full" : "recent"}`,
    ].join("; ");
    process.stderr.write(`${summary}\n`);

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
