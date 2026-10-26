import {homedir} from "node:os";
import {join} from "node:path";
import {
	collectJsonlFiles,
	scanByteCount,
	scanTimeoutMilliseconds,
	selectFilesForScan,
	validateJsonlFile,
} from "./jsonl-corpus";

/**
 * The default disk audit scans the 300 newest JSONL files changed in the last
 * two days, drawn from both session transcripts and the subagent transcripts
 * nested beneath them, reading only the last 4 MiB of each. Records are
 * appended, so the tail holds the newest shapes Claude Code writes, and the
 * cap keeps a few multi-hundred-megabyte transcripts from dominating the run.
 * Run `FULL_JSONL_SCAN=1 just test tests/jsonl-validation.test.ts` to validate
 * every byte of every JSONL file on disk during schema synchronization.
 *
 * The timeout scales with the bytes the selection will read, so a loaded
 * machine or a large corpus slows the audit down instead of timing it out.
 *
 * Only record-shape mismatches fail the audit; those mean the schemas are
 * behind what Claude Code writes. Malformed tool inputs are counted and
 * reported instead, because they record a bad call the model made and no
 * schema change can make them correct.
 */

const DEFAULT_FILE_LIMIT = 300;
const RECENT_TAIL_BYTES = 4 * 1024 * 1024;
const FULL_SCAN = process.env["FULL_JSONL_SCAN"] === "1";
const TAIL_BYTES = FULL_SCAN ? undefined : RECENT_TAIL_BYTES;

const projectsDirectory = join(homedir(), ".claude", "projects");
const collected = await collectJsonlFiles(projectsDirectory);
const selection = selectFilesForScan(collected.files, FULL_SCAN, Date.now(), DEFAULT_FILE_LIMIT);
const scanBytes = scanByteCount(selection.files, TAIL_BYTES);

describe("JsonlRecordSchema against disk", () => {
	it(
		"validates the selected JSONL corpus with bounded memory",
		async () => {
			const failures: string[] = [];
			let toolInputMismatches = 0;
			let parsedLines = 0;
			let skippedUnparseableLines = 0;
			let skippedUnavailableFiles = 0;

			for (const file of selection.files) {
				try {
					const validation = await validateJsonlFile(file, TAIL_BYTES);
					failures.push(...validation.failures);
					toolInputMismatches += validation.toolInputMismatches;
					parsedLines += validation.parsedLines;
					skippedUnparseableLines += validation.skippedUnparseableLines;
				} catch {
					skippedUnavailableFiles++;
				}
			}

			const summary = [
				`Scanned ${selection.files.length - skippedUnavailableFiles} files, ${Math.round(scanBytes / 1024 / 1024)} MiB, and ${parsedLines} lines`,
				`skipped ${selection.skippedForAge} stale files`,
				`${selection.skippedForLimit} files over the cap`,
				`${collected.skippedUnavailablePaths + skippedUnavailableFiles} unavailable paths`,
				`${skippedUnparseableLines} unparseable lines`,
				`and ${toolInputMismatches} malformed tool inputs`,
				`mode=${FULL_SCAN ? "full" : "recent"}`,
			].join("; ");
			// The counts only matter when a full scan was asked for or something failed; a passing verify stays quiet.
			if (FULL_SCAN || failures.length > 0) process.stderr.write(`${summary}\n`);

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
		},
		scanTimeoutMilliseconds(scanBytes),
	);
});
