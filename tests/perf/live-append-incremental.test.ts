import {appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sql} from "drizzle-orm";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import {createJsonlIndexCache, indexFile, indexJsonlFile} from "../../src/lib/db/indexer";
import {startStallMonitor, type EventLoopStall} from "../../src/lib/perf/event-loop-stalls";
import {currentPerfCounters, withPerfScope} from "../../src/lib/perf/server-scope";
import {createPendingApprovalScanCache, scanPendingApproval} from "../../src/lib/pending-approvals";
import {PERF_SHAPES, generateTranscript} from "./fixtures/generate-transcript";

/**
 * A live append to a long transcript must cost time proportional to the appended lines: the watcher re-indexes and
 * rescans for a pending approval by resuming from the last offset it parsed, instead of reading the whole file again.
 * The large-long shape needs PERF_LARGE=1; the default run uses the typical shape.
 */

const SHAPE = process.env["PERF_LARGE"] === "1" ? PERF_SHAPES["large-long"] : PERF_SHAPES.typical;
const PROJECT = "-repo";
const SESSION_ID = "5e7a1c2d-3b4f-4a5b-8c6d-7e8f9a0b1c2d";
/** The resumed read re-reads this many bytes before the offset to confirm the file was not rewritten. */
const SIGNATURE_BYTES = 64;
/** The dev server logs any event-loop stall longer than this (src/server.ts). */
const STALL_BUDGET_MS = 500;

let root: string;
let projectsDir: string;
let file: string;
const dbs: AppDb[] = [];

function openDb(): AppDb {
	const db = openTestDb();
	dbs.push(db);
	return db;
}

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "live-append-incremental-"));
	projectsDir = join(root, "projects");
	mkdirSync(join(projectsDir, PROJECT), {recursive: true});
	file = join(projectsDir, PROJECT, `${SESSION_ID}.jsonl`);
	copyFileSync(await generateTranscript(SHAPE), file);
}, 600_000);

afterEach(() => {
	for (const db of dbs.splice(0)) db.close();
	rmSync(root, {recursive: true, force: true});
});

function appendedText(batch: number): string {
	const records = [
		{
			type: "custom-title",
			sessionId: SESSION_ID,
			customTitle: `Renamed live ${batch}`,
		},
		{
			type: "user",
			sessionId: SESSION_ID,
			uuid: `live-${batch}-u`,
			parentUuid: null,
			cwd: "/repo",
			timestamp: "2000-01-01T00:00:00.000Z",
			message: {role: "user", content: `Live append ${batch}: keep going.`},
		},
		{
			type: "assistant",
			sessionId: SESSION_ID,
			uuid: `live-${batch}-a`,
			parentUuid: `live-${batch}-u`,
			timestamp: "2000-01-01T00:00:01.000Z",
			message: {
				id: `msg-live-${batch}`,
				role: "assistant",
				model: "claude-opus-4-1",
				content: [
					{type: "text", text: `Working on step ${batch}.`},
					{type: "tool_use", id: `toolu_mcp_${batch}`, name: `mcp__live__tool_${batch}`, input: {}},
					{
						type: "tool_use",
						id: `toolu_ask_${batch}`,
						name: "AskUserQuestion",
						input: {
							questions: [{question: `Proceed with ${batch}?`, options: [{label: "Yes"}, {label: "No"}]}],
						},
					},
				],
				usage: {input_tokens: 10, output_tokens: 5},
			},
		},
	];
	return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

function append(batch: number): number {
	const text = appendedText(batch);
	appendFileSync(file, text);
	return Buffer.byteLength(text);
}

async function jsonlCounters(fn: () => Promise<unknown>): Promise<{bytesRead: number; fullScans: number}> {
	return withPerfScope("live-append-incremental", async () => {
		await fn();
		return {...currentPerfCounters()!.jsonl};
	});
}

function indexSnapshot(db: AppDb): Record<string, unknown> {
	const rows = (query: ReturnType<typeof sql>) => db.index.all(query);
	return {
		sessions: rows(sql`SELECT * FROM sessions ORDER BY id`),
		messages: rows(sql`SELECT * FROM session_messages ORDER BY session_id, message_index`),
		content: rows(sql`SELECT session_id, content FROM message_content ORDER BY session_id`),
		mcpTools: rows(sql`SELECT * FROM session_mcp_tools ORDER BY session_id, tool_name`),
		usage: rows(sql`SELECT * FROM usage_daily ORDER BY day, model`),
		ftsHits: rows(sql`SELECT session_id FROM message_content_fts WHERE message_content_fts MATCH 'Live'`),
	};
}

describe(`live append to a ${SHAPE.name} transcript`, () => {
	it("re-indexes only the appended bytes and leaves the same rows as a full re-index", async () => {
		const live = openDb();
		const cache = createJsonlIndexCache();
		await indexJsonlFile(live.index, file, PROJECT, {cache});

		const counters = [];
		for (const batch of [1, 2]) {
			const appended = append(batch);
			counters.push({
				appended: await jsonlCounters(() => indexJsonlFile(live.index, file, PROJECT, {cache})),
				expected: {bytesRead: appended + SIGNATURE_BYTES, fullScans: 0},
			});
		}

		const fresh = openDb();
		await indexJsonlFile(fresh.index, file, PROJECT);
		expect({
			counters: counters.map(({appended}) => appended),
			snapshot: indexSnapshot(live),
		}).toStrictEqual({
			counters: counters.map(({expected}) => expected),
			snapshot: indexSnapshot(fresh),
		});
	}, 600_000);

	it("indexFile links subagents from the cached parse without reading the transcript again", async () => {
		const live = openDb();
		const cache = createJsonlIndexCache();
		await indexFile(live.index, file, projectsDir, undefined, {jsonlCache: cache});
		const appended = append(1);
		const counters = await jsonlCounters(() =>
			indexFile(live.index, file, projectsDir, undefined, {jsonlCache: cache}),
		);
		expect(counters).toStrictEqual({bytesRead: appended + SIGNATURE_BYTES, fullScans: 0});
	}, 600_000);

	it("rescans for a pending approval from the last offset with the same result as a full scan", async () => {
		const cache = createPendingApprovalScanCache();
		await scanPendingApproval(file, cache);
		const appended = append(1);
		let resumed: Awaited<ReturnType<typeof scanPendingApproval>> = null;
		const counters = await jsonlCounters(async () => {
			resumed = await scanPendingApproval(file, cache);
		});
		expect({counters, resumed}).toStrictEqual({
			counters: {bytesRead: appended + SIGNATURE_BYTES, fullScans: 0},
			resumed: await scanPendingApproval(file),
		});
	}, 600_000);

	it("applies an append once when two re-indexes of the file overlap", async () => {
		const live = openDb();
		const cache = createJsonlIndexCache();
		await indexJsonlFile(live.index, file, PROJECT, {cache});
		append(1);
		await Promise.all([
			indexJsonlFile(live.index, file, PROJECT, {cache}),
			indexJsonlFile(live.index, file, PROJECT, {cache}),
		]);
		append(2);
		await indexJsonlFile(live.index, file, PROJECT, {cache});

		const fresh = openDb();
		await indexJsonlFile(fresh.index, file, PROJECT);
		expect(indexSnapshot(live)).toStrictEqual(indexSnapshot(fresh));
	}, 600_000);

	it("falls back to a full re-index when the transcript is rewritten in place", async () => {
		const live = openDb();
		const cache = createJsonlIndexCache();
		await indexJsonlFile(live.index, file, PROJECT, {cache});
		// Same inode and a larger size, but different bytes before the cached offset.
		copyFileSync(await generateTranscript(SHAPE, 2), file);
		append(1);
		await indexJsonlFile(live.index, file, PROJECT, {cache});

		const fresh = openDb();
		await indexJsonlFile(fresh.index, file, PROJECT);
		expect(indexSnapshot(live)).toStrictEqual(indexSnapshot(fresh));
	}, 600_000);

	it("never blocks the event loop past the stall budget while re-indexing an append", async () => {
		const live = openDb();
		const cache = createJsonlIndexCache();
		await indexJsonlFile(live.index, file, PROJECT, {cache});
		append(1);

		const stalls: EventLoopStall[] = [];
		const stopMonitor = startStallMonitor({thresholdMs: STALL_BUDGET_MS, onStall: (stall) => stalls.push(stall)});
		try {
			await indexJsonlFile(live.index, file, PROJECT, {cache});
			await scanPendingApproval(file, createPendingApprovalScanCache());
			await new Promise((resolve) => setTimeout(resolve, 150));
		} finally {
			stopMonitor();
		}
		expect(stalls.map((stall) => Math.round(stall.durationMs))).toStrictEqual([]);
	}, 600_000);
});
