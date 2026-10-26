import {createReadStream} from "node:fs";
import {readdir, stat} from "node:fs/promises";
import {join} from "node:path";
import {createInterface} from "node:readline";
import {JsonlRecordSchema} from "../src/lib/schemas";

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
	sizeBytes: number;
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
	const newestFirst = files.toSorted(
		(left, right) =>
			right.modifiedAtMilliseconds - left.modifiedAtMilliseconds ||
			left.relativePath.localeCompare(right.relativePath),
	);
	if (fullScan) {
		return {files: newestFirst, skippedForAge: 0, skippedForLimit: 0};
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

/** Bytes a scan reads: each file's tail when `tailBytes` caps it, otherwise the whole file. */
export function scanByteCount(files: readonly JsonlFile[], tailBytes: number | undefined): number {
	return files.reduce(
		(total, file) => total + (tailBytes === undefined ? file.sizeBytes : Math.min(file.sizeBytes, tailBytes)),
		0,
	);
}

/**
 * A minute of headroom plus one second per 2 MiB. An idle machine validates
 * roughly 20 MiB/s, so the 2 MiB/s floor tolerates a tenfold slowdown under
 * load while a hung scan still fails.
 */
export function scanTimeoutMilliseconds(bytes: number): number {
	const bytesPerSecond = 2 * 1024 * 1024;
	return 60_000 + Math.ceil((bytes / bytesPerSecond) * 1000);
}

export interface FileValidation {
	failures: string[];
	toolInputMismatches: number;
	parsedLines: number;
	skippedUnparseableLines: number;
}

/**
 * Validates every record in `file`, or only its last `tailBytes` bytes. New
 * records are appended, so the tail of a transcript holds the newest shapes
 * Claude Code writes, which is where schema drift appears. A tail read starts
 * mid-record, so its first line is dropped, and its failures are located as
 * `tail+<line>` because absolute line numbers are unknown.
 */
export async function validateJsonlFile(file: JsonlFile, tailBytes: number | undefined): Promise<FileValidation> {
	const start = tailBytes === undefined ? 0 : Math.max(0, file.sizeBytes - tailBytes);
	const linePrefix = start > 0 ? "tail+" : "";
	const failures: string[] = [];
	let toolInputMismatches = 0;
	let parsedLines = 0;
	let skippedUnparseableLines = 0;
	let lineNumber = 0;
	const lines = createInterface({
		input: createReadStream(file.path, {encoding: "utf8", start}),
		crlfDelay: Infinity,
	});

	for await (const rawLine of lines) {
		lineNumber++;
		if (start > 0 && lineNumber === 1) continue;
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

		const {recordIssues, toolInputIssues} = partitionIssues(result.error.issues);
		if (toolInputIssues.length > 0) toolInputMismatches++;
		if (recordIssues.length > 0) {
			const issues = recordIssues.map((issue) => `  ${issue}`).join("\n");
			failures.push(`${file.relativePath}:${linePrefix}${lineNumber}\n${issues}`);
		}
	}

	return {failures, toolInputMismatches, parsedLines, skippedUnparseableLines};
}

/**
 * Tool-input issues come from the `ContentBlockSchema` refinement, which
 * re-paths them under `message.content.<n>.input`. They mean the model emitted
 * a malformed tool call — a fact about the recorded conversation, not evidence
 * that our schema is behind. Record-shape issues are the ones that mean drift.
 */
export function partitionIssues(issues: readonly {path: PropertyKey[]; message: string}[]): {
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
	return {recordIssues, toolInputIssues};
}

async function statJsonlFiles(
	directory: string,
	relativeDirectory: string,
): Promise<{files: JsonlFile[]; skippedUnavailablePaths: number}> {
	let entries;
	try {
		entries = await readdir(directory, {withFileTypes: true});
	} catch {
		return {files: [], skippedUnavailablePaths: 0};
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
					sizeBytes: fileStat.size,
				});
			} catch {
				skippedUnavailablePaths++;
			}
		}),
	);
	return {files, skippedUnavailablePaths};
}

export async function collectJsonlFiles(projectsDirectory: string): Promise<{
	files: JsonlFile[];
	skippedUnavailablePaths: number;
}> {
	let projectEntries;
	try {
		projectEntries = await readdir(projectsDirectory, {withFileTypes: true});
	} catch {
		return {files: [], skippedUnavailablePaths: 0};
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
			sessionEntries = await readdir(projectPath, {withFileTypes: true});
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
	return {files, skippedUnavailablePaths};
}
