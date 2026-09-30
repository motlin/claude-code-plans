import {readdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

/**
 * `vp exec tsx scripts/perf-record-mix.ts` (measurement plan §4.1): a read-only scan of every transcript under
 * ~/.claude/projects (top-level sessions and subagents) that writes tests/perf/fixtures/record-mix.json, so perf
 * fixtures can match the real corpus shape. The profile holds only numbers keyed by record type and tool name; it never
 * copies message text, commands, paths or ids. MCP tools fold into one "(mcp)" key because their names embed server names.
 */

type Histogram = Record<string, number>;

export interface RecordMix {
	totals: {files: number; subagentFiles: number; lines: number; bytes: number};
	fileBytes: Histogram;
	fileLines: Histogram;
	recordTypes: Record<string, number>;
	lineBytesByType: Record<string, Histogram>;
	toolNames: Record<string, number>;
	toolUseLineBytes: Record<string, Histogram>;
	toolResultLineBytes: Record<string, Histogram>;
	imageLines: number;
	imageLineFraction: number;
}

const UNPARSEABLE = "(unparseable)";
const UNKNOWN = "(unknown)";
const MCP = "(mcp)";
const OUTPUT_PATH = fileURLToPath(new URL("../tests/perf/fixtures/record-mix.json", import.meta.url));

/** Lower bound of the power-of-two bucket holding `size`: 700 lands in "512", meaning [512, 1024). */
function bucket(size: number): string {
	return size <= 0 ? "0" : String(2 ** Math.floor(Math.log2(size)));
}

function increment(counts: Record<string, number>, key: string): void {
	counts[key] = (counts[key] ?? 0) + 1;
}

function record(histograms: Record<string, Histogram>, key: string, size: number): void {
	increment((histograms[key] ??= {}), bucket(size));
}

function toolKey(name: string): string {
	return name.toLowerCase().startsWith("mcp__") ? MCP : name;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsImage(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(containsImage);
	}
	if (!isObject(value)) {
		return false;
	}
	return value["type"] === "image" || containsImage(value["content"]);
}

function contentBlocks(parsed: Record<string, unknown>): Record<string, unknown>[] {
	const message = parsed["message"];
	const content = isObject(message) ? message["content"] : undefined;
	return Array.isArray(content) ? content.filter(isObject) : [];
}

function sortKeys<T>(object: Record<string, T>): Record<string, T> {
	return Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function listJsonl(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...listJsonl(path));
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			found.push(path);
		}
	}
	return found.sort();
}

export function scanRecordMix(projectsDir: string): RecordMix {
	const mix: RecordMix = {
		totals: {files: 0, subagentFiles: 0, lines: 0, bytes: 0},
		fileBytes: {},
		fileLines: {},
		recordTypes: {},
		lineBytesByType: {},
		toolNames: {},
		toolUseLineBytes: {},
		toolResultLineBytes: {},
		imageLines: 0,
		imageLineFraction: 0,
	};

	for (const file of listJsonl(projectsDir)) {
		const text = readFileSync(file, "utf8");
		const toolNamesById = new Map<string, string>();
		let fileLineCount = 0;
		mix.totals.files += 1;
		if (file.includes(`${sep}subagents${sep}`)) {
			mix.totals.subagentFiles += 1;
		}
		increment(mix.fileBytes, bucket(Buffer.byteLength(text, "utf8")));

		for (const lineText of text.split("\n")) {
			if (lineText.trim() === "") {
				continue;
			}
			const size = Buffer.byteLength(lineText, "utf8");
			fileLineCount += 1;
			mix.totals.lines += 1;
			mix.totals.bytes += size;

			let parsed: unknown;
			try {
				parsed = JSON.parse(lineText);
			} catch {
				parsed = undefined;
			}
			if (!isObject(parsed)) {
				increment(mix.recordTypes, UNPARSEABLE);
				record(mix.lineBytesByType, UNPARSEABLE, size);
				continue;
			}

			const type = typeof parsed["type"] === "string" ? parsed["type"] : UNKNOWN;
			increment(mix.recordTypes, type);
			record(mix.lineBytesByType, type, size);

			const blocks = contentBlocks(parsed);
			const toolUses = new Set<string>();
			const toolResults = new Set<string>();
			for (const block of blocks) {
				if (block["type"] === "tool_use" && typeof block["name"] === "string") {
					const name = toolKey(block["name"]);
					increment(mix.toolNames, name);
					toolUses.add(name);
					if (typeof block["id"] === "string") {
						toolNamesById.set(block["id"], name);
					}
				} else if (block["type"] === "tool_result") {
					const id = block["tool_use_id"];
					toolResults.add((typeof id === "string" ? toolNamesById.get(id) : undefined) ?? UNKNOWN);
				}
			}
			for (const name of toolUses) {
				record(mix.toolUseLineBytes, name, size);
			}
			for (const name of toolResults) {
				record(mix.toolResultLineBytes, name, size);
			}
			if (containsImage(blocks)) {
				mix.imageLines += 1;
			}
		}
		increment(mix.fileLines, bucket(fileLineCount));
	}

	mix.recordTypes = sortKeys(mix.recordTypes);
	mix.lineBytesByType = sortKeys(mix.lineBytesByType);
	mix.toolNames = sortKeys(mix.toolNames);
	mix.toolUseLineBytes = sortKeys(mix.toolUseLineBytes);
	mix.toolResultLineBytes = sortKeys(mix.toolResultLineBytes);
	mix.imageLineFraction = mix.totals.lines === 0 ? 0 : Math.round((mix.imageLines / mix.totals.lines) * 1e6) / 1e6;
	return mix;
}

function main(): void {
	const projectsDir = process.argv[2] ?? join(homedir(), ".claude", "projects");
	const mix = scanRecordMix(projectsDir);
	writeFileSync(OUTPUT_PATH, `${JSON.stringify(mix, null, "\t")}\n`);
	console.log(
		`Scanned ${mix.totals.files} files, ${mix.totals.lines} lines, ${mix.totals.bytes} bytes -> ${OUTPUT_PATH}`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
