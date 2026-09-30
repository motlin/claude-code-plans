import {createHash} from "node:crypto";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {eq} from "drizzle-orm";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "vite-plus/test";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import {sessions} from "../../src/lib/db/schema";
import {JsonlRecordSchema} from "../../src/lib/schemas";
import {
	GENERATOR_VERSION,
	PERF_SHAPES,
	type PerfShape,
	generateTranscript,
	perfShapes,
	renderTranscript,
	seedFixtureDb,
} from "./fixtures/generate-transcript";

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function lineSizes(text: string): number[] {
	return text
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => Buffer.byteLength(line) + 1);
}

function topPercentShare(sizes: number[]): number {
	const sorted = [...sizes].sort((a, b) => b - a);
	const top = sorted.slice(0, Math.ceil(sorted.length / 100));
	const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
	return sum(top) / sum(sorted);
}

// A tenth-scale large-wide shape, so the wide byte distribution is checked on every run without 64 MB of output.
const WIDE_SCALED: PerfShape = {...PERF_SHAPES["large-wide"], name: "wide-scaled", bytes: 6_400_000, lines: 540};

let cacheDir: string;

beforeAll(() => {
	cacheDir = mkdtempSync(join(tmpdir(), "ccb-perf-fixtures-"));
});

afterAll(() => {
	rmSync(cacheDir, {recursive: true, force: true});
});

describe("renderTranscript", () => {
	it("is deterministic for a seed and differs across seeds", () => {
		const first = sha256(renderTranscript(PERF_SHAPES.small, 7));
		const second = sha256(renderTranscript(PERF_SHAPES.small, 7));
		const other = sha256(renderTranscript(PERF_SHAPES.small, 8));
		expect({same: first === second, differs: first !== other}).toStrictEqual({same: true, differs: true});
	});

	it("gives the scaled large-wide shape a top 1% byte share between 50% and 65%", () => {
		const share = topPercentShare(lineSizes(renderTranscript(WIDE_SCALED, 1)));
		expect({low: share >= 0.5, high: share <= 0.65}).toStrictEqual({low: true, high: true});
	});

	it("chains uuids and pairs every tool_use with a following tool_result", () => {
		const records = renderTranscript(PERF_SHAPES.small, 3)
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const seen = new Set<string>();
		const pendingToolUses = new Set<string>();
		const problems: string[] = [];
		let lastTimestamp = "";
		let previousUuid: string | null = null;
		for (const record of records) {
			if (typeof record["uuid"] !== "string") continue;
			const {uuid, parentUuid, timestamp} = record as {
				uuid: string;
				parentUuid: string | null;
				timestamp: string;
			};
			if (parentUuid !== previousUuid) problems.push(`${uuid} parent ${String(parentUuid)}`);
			if (timestamp <= lastTimestamp) problems.push(`${uuid} timestamp ${timestamp}`);
			if (seen.has(uuid)) problems.push(`${uuid} duplicate`);
			seen.add(uuid);
			previousUuid = uuid;
			lastTimestamp = timestamp;
			const content = (record["message"] as {content?: unknown} | undefined)?.content;
			if (!Array.isArray(content)) continue;
			for (const block of content as Array<{type: string; id?: string; tool_use_id?: string}>) {
				if (block.type === "tool_use" && block.id) pendingToolUses.add(block.id);
				if (block.type === "tool_result" && block.tool_use_id) {
					if (!pendingToolUses.delete(block.tool_use_id)) problems.push(`orphan ${block.tool_use_id}`);
				}
			}
		}
		expect({problems, pending: [...pendingToolUses]}).toStrictEqual({problems: [], pending: []});
	});
});

describe.each(perfShapes().map((shape) => [shape.name, shape] as const))("shape %s", (_name, shape) => {
	let text: string;

	beforeAll(async () => {
		text = readFileSync(await generateTranscript(shape, 1, {cacheDir}), "utf-8");
	}, 300_000);

	it("is within 2% of the target bytes and lines", () => {
		const bytes = Buffer.byteLength(text);
		const lines = lineSizes(text).length;
		expect({
			bytes: Math.abs(bytes - shape.bytes) / shape.bytes <= 0.02,
			lines: Math.abs(lines - shape.lines) / shape.lines <= 0.02,
		}).toStrictEqual({bytes: true, lines: true});
	});

	it("parses every line with JsonlRecordSchema", () => {
		const failures = text
			.split("\n")
			.filter((line) => line.length > 0)
			.flatMap((line, index) => {
				const result = JsonlRecordSchema.safeParse(JSON.parse(line));
				return result.success ? [] : [`line ${index + 1}: ${result.error.message.slice(0, 300)}`];
			});
		expect(failures).toStrictEqual([]);
	});

	it.runIf(shape.name === "large-wide")("puts 50% to 65% of the bytes in the top 1% of lines", () => {
		const share = topPercentShare(lineSizes(text));
		expect({low: share >= 0.5, high: share <= 0.65}).toStrictEqual({low: true, high: true});
	});
});

describe("generateTranscript cache", () => {
	it("writes <shape>-<seed>-<version>.jsonl once and reuses it", async () => {
		const path = await generateTranscript(PERF_SHAPES.small, 11, {cacheDir});
		const again = await generateTranscript(PERF_SHAPES.small, 11, {cacheDir});
		expect({
			name: basename(path),
			again: again === path,
			exists: existsSync(path),
			content: readFileSync(path, "utf-8") === renderTranscript(PERF_SHAPES.small, 11),
		}).toStrictEqual({name: `small-11-${GENERATOR_VERSION}.jsonl`, again: true, exists: true, content: true});
	});
});

describe("perfShapes", () => {
	const original = process.env["PERF_LARGE"];

	afterEach(() => {
		if (original === undefined) delete process.env["PERF_LARGE"];
		else process.env["PERF_LARGE"] = original;
	});

	it("hides the large shapes without PERF_LARGE", () => {
		delete process.env["PERF_LARGE"];
		expect(perfShapes().map((shape) => shape.name)).toStrictEqual(["small", "typical"]);
	});

	it("adds the large shapes with PERF_LARGE=1", () => {
		process.env["PERF_LARGE"] = "1";
		expect(perfShapes().map((shape) => shape.name)).toStrictEqual(["small", "typical", "large-long", "large-wide"]);
	});
});

describe("seedFixtureDb", () => {
	let db: AppDb;

	afterEach(() => {
		db.close();
	});

	it("indexes generated transcripts into a test DB with the real indexer", async () => {
		db = openTestDb();
		const path = await generateTranscript(PERF_SHAPES.small, 1, {cacheDir});
		const sessionIds = await seedFixtureDb(db, [path]);
		const session = db.index
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionIds[0] ?? ""))
			.get();
		expect({
			sessionIds,
			found: session?.id,
			hasMessages: (session?.messageCount ?? 0) > 0,
		}).toStrictEqual({
			sessionIds: [`small-1-${GENERATOR_VERSION}`],
			found: `small-1-${GENERATOR_VERSION}`,
			hasMessages: true,
		});
	});
});
