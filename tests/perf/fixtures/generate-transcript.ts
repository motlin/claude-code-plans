import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import type {AppDb} from "../../../src/lib/db/connection";
import {indexJsonlFile} from "../../../src/lib/db/indexer";

/**
 * Deterministic perf transcripts (measurement plan §4.1). A seeded mulberry32 PRNG emits schema-valid JSONL whose
 * record types, tool names and per-type line sizes follow the checked-in corpus profile in record-mix.json. Records
 * carry uuid/parentUuid chains, paired tool_use/tool_result blocks and strictly increasing timestamps.
 *
 * Bump GENERATOR_VERSION whenever the output for a given (shape, seed) changes, so cached files are regenerated.
 */
export const GENERATOR_VERSION = 1;

export interface PerfShape {
	name: string;
	/** Target file size in bytes, newlines included. */
	bytes: number;
	lines: number;
	/** When set, the top 1% of lines hold this share of the bytes (base64 images and huge tool results). */
	wideShare?: number;
}

export type PerfShapeName = "small" | "typical" | "large-long" | "large-wide";

export const PERF_SHAPES: Record<PerfShapeName, PerfShape> = {
	small: {name: "small", bytes: 500_000, lines: 400},
	typical: {name: "typical", bytes: 4_500_000, lines: 3_500},
	"large-long": {name: "large-long", bytes: 20_000_000, lines: 9_000},
	"large-wide": {name: "large-wide", bytes: 64_000_000, lines: 5_400, wideShare: 0.58},
};

/** small and typical always; the large shapes only with PERF_LARGE=1 (plan §7 decision 5). */
export function perfShapes(): PerfShape[] {
	const shapes = [PERF_SHAPES.small, PERF_SHAPES.typical];
	if (process.env["PERF_LARGE"] === "1") shapes.push(PERF_SHAPES["large-long"], PERF_SHAPES["large-wide"]);
	return shapes;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = join(HERE, "..", "..", "..", "node_modules", ".cache", "ccb-perf", "fixtures");
const RECORD_MIX_PATH = join(HERE, "record-mix.json");

const HistogramSchema = z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative());

const RecordMixSchema = z
	.object({
		totals: z
			.object({
				files: z.number(),
				subagentFiles: z.number(),
				lines: z.number(),
				bytes: z.number(),
			})
			.strict(),
		fileBytes: HistogramSchema,
		fileLines: HistogramSchema,
		recordTypes: z.record(z.string(), z.number().int().nonnegative()),
		lineBytesByType: z.record(z.string(), HistogramSchema),
		toolNames: z.record(z.string(), z.number().int().nonnegative()),
		toolUseLineBytes: z.record(z.string(), HistogramSchema),
		toolResultLineBytes: z.record(z.string(), HistogramSchema),
		imageLines: z.number().int().nonnegative(),
		imageLineFraction: z.number().nonnegative(),
	})
	.strict();

type RecordMix = z.infer<typeof RecordMixSchema>;
type Histogram = z.infer<typeof HistogramSchema>;

let cachedMix: RecordMix | undefined;

function recordMix(): RecordMix {
	cachedMix ??= RecordMixSchema.parse(JSON.parse(readFileSync(RECORD_MIX_PATH, "utf-8")));
	return cachedMix;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

class Rng {
	readonly next: () => number;

	constructor(seed: number) {
		this.next = mulberry32(seed);
	}

	int(bound: number): number {
		return Math.floor(this.next() * bound);
	}

	weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
		const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
		let roll = this.next() * total;
		for (const [value, weight] of entries) {
			roll -= weight;
			if (roll < 0) return value;
		}
		const last = entries.at(-1);
		if (!last) throw new Error("weighted() needs at least one entry");
		return last[0];
	}

	/** A byte size drawn from a log-bucketed histogram: pick a bucket by count, then uniform within [lo, 2*lo). */
	size(histogram: Histogram | undefined): number {
		const entries = Object.entries(histogram ?? {}).map(([bucket, count]) => [Number(bucket), count] as const);
		if (entries.length === 0) return 1024;
		const low = Math.max(this.weighted(entries), 1);
		return low + this.int(low);
	}

	uuid(): string {
		const hex = Array.from({length: 4}, () => (this.int(0x100000000) >>> 0).toString(16).padStart(8, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
	}
}

const PAD = "@@PAD@@";
const CWD = "/repo";
const START_MS = Date.UTC(2026, 0, 1);

type LineKind =
	| "prompt"
	| "tool_use"
	| "tool_result"
	| "text"
	| "thinking"
	| "attachment"
	| "system"
	| "ai-title"
	| "last-prompt"
	| "mode"
	| "permission-mode";

const TOOLS = ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "(mcp)"] as const;
type Tool = (typeof TOOLS)[number];

interface PlannedLine {
	/** The serialized record with PAD where the filler goes, or no PAD when the line takes no filler. */
	skeleton: string;
	/** Relative filler weight, drawn from the profile's line-size histogram for this kind. */
	weight: number;
	/** The filler is base64 (image data) rather than words. */
	base64: boolean;
	kind: LineKind;
	tool?: Tool;
}

function toolInput(tool: Tool, rng: Rng): Record<string, unknown> {
	const file = `${CWD}/src/module-${rng.int(500)}.ts`;
	switch (tool) {
		case "Bash":
			return {command: PAD, description: "Run a perf fixture step"};
		case "Read":
			return {file_path: `${CWD}/src/${PAD}.ts`};
		case "Edit":
			return {file_path: file, old_string: "const value = 1;", new_string: PAD};
		case "Write":
			return {file_path: file, content: PAD};
		case "Grep":
			return {pattern: PAD, path: CWD};
		case "Glob":
			return {pattern: PAD};
		case "(mcp)":
			return {query: PAD};
		default:
			return tool satisfies never;
	}
}

function toolName(tool: Tool): string {
	return tool === "(mcp)" ? "mcp__perf__search" : tool;
}

/** Plans every line's record and filler weight. Pure in (shape, seed). */
function planLines(shape: PerfShape, rng: Rng): PlannedLine[] {
	const mix = recordMix();
	const count = (type: string) => mix.recordTypes[type] ?? 0;
	const toolWeights = TOOLS.map((tool) => [tool, mix.toolNames[tool] ?? 0] as const);
	const toolUses = Object.values(mix.toolNames).reduce((sum, value) => sum + value, 0);
	const toolUseFraction = Math.min(toolUses / Math.max(count("assistant"), 1), 0.9);
	const typeWeights = [
		["user", Math.max(count("user") - toolUses, count("user") / 10)],
		["assistant", count("assistant")],
		["attachment", count("attachment")],
		["system", count("system")],
		["ai-title", count("ai-title")],
		["last-prompt", count("last-prompt")],
		["mode", count("mode")],
		["permission-mode", count("permission-mode")],
	] as const;

	const sessionId = rng.uuid();
	let parentUuid: string | null = null;
	let clock = START_MS;
	let pending: {id: string; tool: Tool; assistantUuid: string} | undefined;
	const lines: PlannedLine[] = [];

	const chained = (
		type: string,
		fields: Record<string, unknown>,
	): {record: Record<string, unknown>; uuid: string} => {
		const uuid = rng.uuid();
		clock += 500 + rng.int(4_000);
		const record = {
			parentUuid,
			isSidechain: false,
			userType: "external",
			cwd: CWD,
			sessionId,
			version: "2.1.0",
			gitBranch: "main",
			type,
			...fields,
			uuid,
			timestamp: new Date(clock).toISOString(),
		};
		parentUuid = uuid;
		return {record, uuid};
	};

	const push = (kind: LineKind, record: Record<string, unknown>, histogram: Histogram | undefined, tool?: Tool) => {
		const skeleton = JSON.stringify(record);
		const weight = skeleton.includes(PAD) ? rng.size(histogram) : 0;
		lines.push({skeleton, weight, base64: false, kind, ...(tool ? {tool} : {})});
	};

	while (lines.length < shape.lines) {
		const remaining = shape.lines - lines.length;
		if (pending) {
			const {record} = chained("user", {
				message: {role: "user", content: [{type: "tool_result", tool_use_id: pending.id, content: PAD}]},
				sourceToolAssistantUUID: pending.assistantUuid,
			});
			push("tool_result", record, mix.toolResultLineBytes[pending.tool], pending.tool);
			pending = undefined;
			continue;
		}
		const recordType = rng.weighted(typeWeights);
		switch (recordType) {
			case "user":
				push(
					"prompt",
					chained("user", {message: {role: "user", content: PAD}}).record,
					mix.lineBytesByType["user"],
				);
				break;
			case "assistant": {
				const roll = rng.next();
				const message = (content: unknown[]) => ({
					role: "assistant",
					model: "claude-perf-fixture",
					id: `msg_${rng.int(0x7fffffff).toString(36)}`,
					type: "message",
					content,
					stop_reason: null,
					stop_sequence: null,
					usage: {input_tokens: rng.int(5_000), output_tokens: rng.int(2_000)},
				});
				if (roll < toolUseFraction && remaining >= 2) {
					const tool = rng.weighted(toolWeights);
					const id = `toolu_${rng.int(0x7fffffff).toString(36)}${rng.int(0x7fffffff).toString(36)}`;
					const {record, uuid} = chained("assistant", {
						message: message([{type: "tool_use", id, name: toolName(tool), input: toolInput(tool, rng)}]),
					});
					push("tool_use", record, mix.toolUseLineBytes[tool], tool);
					pending = {id, tool, assistantUuid: uuid};
				} else if (roll < toolUseFraction + (1 - toolUseFraction) / 3) {
					const content = [{type: "thinking", thinking: PAD, signature: "perf-fixture-signature"}];
					push(
						"thinking",
						chained("assistant", {message: message(content)}).record,
						mix.lineBytesByType["assistant"],
					);
				} else {
					const content = [{type: "text", text: PAD}];
					push(
						"text",
						chained("assistant", {message: message(content)}).record,
						mix.lineBytesByType["assistant"],
					);
				}
				break;
			}
			case "attachment": {
				const attachment =
					rng.next() < 0.5
						? {type: "edited_text_file", filename: `${CWD}/src/module-${rng.int(500)}.ts`, snippet: PAD}
						: {type: "hook_success", hookName: "PostToolUse:Bash", hookEvent: "PostToolUse", content: PAD};
				push("attachment", chained("attachment", {attachment}).record, mix.lineBytesByType["attachment"]);
				break;
			}
			case "system":
				push(
					"system",
					chained("system", {subtype: "informational", content: PAD, level: "info", isMeta: false}).record,
					mix.lineBytesByType["system"],
				);
				break;
			case "ai-title":
				push("ai-title", {type: "ai-title", aiTitle: PAD, sessionId}, mix.lineBytesByType["ai-title"]);
				break;
			case "last-prompt":
				push(
					"last-prompt",
					{type: "last-prompt", lastPrompt: PAD, sessionId},
					mix.lineBytesByType["last-prompt"],
				);
				break;
			case "mode":
				push("mode", {type: "mode", mode: "normal", sessionId}, undefined);
				break;
			case "permission-mode":
				push("permission-mode", {type: "permission-mode", permissionMode: "default", sessionId}, undefined);
				break;
			default:
				recordType satisfies never;
		}
	}
	return lines;
}

/** Splits `budget` bytes across `indices` in proportion to `weight`, exactly (largest remainders get the leftovers). */
function allocate(budget: number, indices: number[], weight: (index: number) => number, into: number[]): void {
	if (budget < 0) throw new Error(`perf fixture budget is negative (${budget}); the shape is too small`);
	const total = indices.reduce((sum, index) => sum + weight(index), 0);
	if (indices.length === 0 || total === 0) {
		if (budget > 0) throw new Error("perf fixture has filler budget but no lines to put it in");
		return;
	}
	let assigned = 0;
	const remainders: Array<[number, number]> = [];
	for (const index of indices) {
		const exact = (budget * weight(index)) / total;
		const whole = Math.floor(exact);
		into[index] = whole;
		assigned += whole;
		remainders.push([index, exact - whole]);
	}
	remainders.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	for (let step = 0; step < budget - assigned; step++) {
		const entry = remainders[step % remainders.length];
		if (entry) into[entry[0]] = (into[entry[0]] ?? 0) + 1;
	}
}

const WORDS = [
	"the",
	"session",
	"index",
	"render",
	"tool",
	"result",
	"value",
	"stream",
	"fixture",
	"parse",
	"query",
	"module",
	"export",
	"const",
	"return",
	"await",
	"line",
	"perf",
	"cache",
	"schema",
];

function wordFiller(length: number, rng: Rng): string {
	const parts: string[] = [];
	let size = 0;
	while (size <= length) {
		const word = WORDS[rng.int(WORDS.length)] ?? "x";
		parts.push(word);
		size += word.length + 1;
	}
	return parts.join(" ").slice(0, length);
}

function base64Filler(length: number, rng: Rng): string {
	const bytes = Buffer.alloc(Math.ceil((length * 3) / 4) + 4);
	for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
		bytes.writeUInt32LE(rng.int(0x100000000) >>> 0, offset);
	}
	return bytes.toString("base64").slice(0, length);
}

/** The whole transcript for (shape, seed) as JSONL text. Byte-for-byte deterministic. */
export function renderTranscript(shape: PerfShape, seed: number): string {
	const rng = new Rng(seed);
	const lines = planLines(shape, rng);

	if (shape.wideShare !== undefined) {
		// The widest 1% of lines are tool results: Read results become base64 images, the rest huge text output.
		const results = lines.flatMap((line, index) => (line.kind === "tool_result" ? [index] : []));
		const wideCount = Math.ceil(lines.length / 100);
		const wide = new Set<number>();
		while (wide.size < Math.min(wideCount, results.length)) {
			const index = results[rng.int(results.length)];
			if (index !== undefined) wide.add(index);
		}
		for (const index of wide) {
			const line = lines[index];
			if (line?.tool !== "Read") continue;
			const record = JSON.parse(line.skeleton) as {message: {content: Array<{content: unknown}>}};
			const block = record.message.content[0];
			if (block) block.content = [{type: "image", source: {type: "base64", media_type: "image/png", data: PAD}}];
			line.skeleton = JSON.stringify(record);
			line.base64 = true;
		}
		const cap = Math.floor((shape.bytes * shape.wideShare) / Math.max(wide.size, 1) / 4);
		for (const [index, line] of lines.entries()) {
			if (wide.has(index)) line.weight = 0.5 + rng.next();
			else line.weight = Math.min(line.weight, cap);
		}
		const skeletonBytes = (indices: number[]) =>
			indices.reduce((sum, index) => sum + (lines[index]?.skeleton.length ?? 0) - PAD.length + 1, 0);
		const wideIndices = [...wide].sort((a, b) => a - b);
		const narrowIndices = lines.flatMap((line, index) =>
			!wide.has(index) && line.skeleton.includes(PAD) ? [index] : [],
		);
		const bareBytes = lines.reduce(
			(sum, line) => sum + (line.skeleton.includes(PAD) ? 0 : line.skeleton.length + 1),
			0,
		);
		const wideBudget = Math.round(shape.bytes * shape.wideShare) - skeletonBytes(wideIndices);
		const narrowBudget =
			shape.bytes - wideBudget - skeletonBytes(wideIndices) - skeletonBytes(narrowIndices) - bareBytes;
		const fill: number[] = Array.from({length: lines.length}, () => 0);
		allocate(wideBudget, wideIndices, (index) => lines[index]?.weight ?? 0, fill);
		allocate(narrowBudget, narrowIndices, (index) => lines[index]?.weight ?? 0, fill);
		return materialize(lines, fill, rng);
	}

	const padded = lines.flatMap((line, index) => (line.skeleton.includes(PAD) ? [index] : []));
	const fixedBytes = lines.reduce(
		(sum, line) => sum + line.skeleton.length + 1 - (line.skeleton.includes(PAD) ? PAD.length : 0),
		0,
	);
	const fill: number[] = Array.from({length: lines.length}, () => 0);
	allocate(shape.bytes - fixedBytes, padded, (index) => lines[index]?.weight ?? 0, fill);
	return materialize(lines, fill, rng);
}

function materialize(lines: PlannedLine[], fill: number[], rng: Rng): string {
	return lines
		.map((line, index) => {
			const at = line.skeleton.indexOf(PAD);
			if (at < 0) return `${line.skeleton}\n`;
			const length = fill[index] ?? 0;
			const filler = line.base64 ? base64Filler(length, rng) : wordFiller(length, rng);
			return `${line.skeleton.slice(0, at)}${filler}${line.skeleton.slice(at + PAD.length)}\n`;
		})
		.join("");
}

/**
 * Path to the cached transcript for (shape, seed), generating it on first use. Files are keyed
 * `<shape>-<seed>-<GENERATOR_VERSION>.jsonl` and written atomically, so parallel workers can share the cache.
 */
export async function generateTranscript(
	shape: PerfShape,
	seed = 1,
	options: {cacheDir?: string} = {},
): Promise<string> {
	const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
	const path = join(cacheDir, `${shape.name}-${seed}-${GENERATOR_VERSION}.jsonl`);
	if (existsSync(path)) return path;
	mkdirSync(cacheDir, {recursive: true});
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, renderTranscript(shape, seed));
	renameSync(temporary, path);
	return path;
}

const PERF_PROJECT = "-repo";

/** Indexes the transcripts into `db` with the production indexer. Returns their session ids (file basenames). */
export async function seedFixtureDb(db: AppDb, files: string[]): Promise<string[]> {
	const sessionIds: string[] = [];
	for (const file of files) {
		await indexJsonlFile(db.index, file, PERF_PROJECT);
		sessionIds.push(basename(file, ".jsonl"));
	}
	return sessionIds;
}
