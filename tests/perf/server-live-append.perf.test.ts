import {afterAll, beforeAll, describe, it, vi} from "vite-plus/test";
import {appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import type {AppDb} from "../../src/lib/db/connection";
import type {PerfCounters} from "../../src/lib/perf/server-scope";
import {indexJsonlFile} from "../../src/lib/db/indexer";
import {generateTranscript, PERF_SHAPES, perfShapes, seedFixtureDb} from "./fixtures/generate-transcript";
import {
	LIVE_APPEND_MULTI_PREFIX,
	LIVE_APPEND_SIZES,
	type LiveAppendMetric,
	type LiveAppendMultiMetric,
	liveAppendPrefix,
	metricIds,
} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Server lab benchmark for a live append to one active session (measurement plan §2.4 L3, §7 decision 5). Drives the
 * watcher's JSONL fire body directly against a seeded fixture DB and ratchets what one append costs per fixture shape.
 * readAmplification is JSONL bytes read divided by bytes appended, so an incremental fire would read about 1.
 *
 * The multi-writer variant is the normal load: several agents append at once, and every fire fans out to every tab.
 */

const PROJECT = "-repo";

let root: string;
let projectsDir: string;
let db: AppDb;
let serverScope: typeof import("../../src/lib/perf/server-scope");
let watcher: typeof import("../../src/lib/watcher");
let sseBroadcast: typeof import("../../src/lib/sse-broadcast");
const offsets = new Map<string, number>();
const files = new Map<string, string>();

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "perf-live-append-"));
	const home = join(root, "home");
	projectsDir = join(home, ".claude", "projects");
	mkdirSync(join(projectsDir, PROJECT), {recursive: true});
	vi.stubEnv("HOME", home);
	vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));

	// Load the watcher and the scope as one module graph, so the fire body reports into the scope this test opens.
	vi.resetModules();
	const {openTestDb} = await import("../../src/lib/db/connection");
	db = openTestDb();
	vi.doMock("../../src/lib/db", () => ({getDb: () => db, awaitInitialScan: () => Promise.resolve()}));
	serverScope = await import("../../src/lib/perf/server-scope");
	watcher = await import("../../src/lib/watcher");
	sseBroadcast = await import("../../src/lib/sse-broadcast");

	// Copies, not symlinks: the test appends to these files.
	for (const shape of perfShapes()) {
		const cached = await generateTranscript(shape);
		const file = join(projectsDir, PROJECT, basename(cached));
		copyFileSync(cached, file);
		files.set(shape.name, file);
	}
	await seedFixtureDb(db, [...files.values()]);
}, 600_000);

afterAll(() => {
	db.close();
	rmSync(root, {recursive: true, force: true});
	vi.doUnmock("../../src/lib/db");
	vi.unstubAllEnvs();
	vi.resetModules();
});

function appendedLines(sessionId: string, count: number, batch: number): string {
	let text = "";
	for (let index = 0; index < count; index++) {
		const turn = `${batch}-${index}`;
		text += `${JSON.stringify({
			type: "user",
			sessionId,
			uuid: `live-append-${turn}`,
			parentUuid: null,
			timestamp: "2000-01-01T00:00:00.000Z",
			message: {role: "user", content: `Live append ${turn}: keep going with the next step.`},
		})}\n`;
	}
	return text;
}

async function fire(file: string): Promise<{counters: PerfCounters; payloadBytes: number}> {
	return serverScope.withPerfScope("live-append", async () => {
		let payloadBytes = 0;
		await watcher.processJsonlAppend(
			db.index,
			file,
			offsets,
			(type, data) => {
				// Same framing as broadcastTyped; drop the temp root so the size is the same on every machine.
				const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
				payloadBytes += Buffer.byteLength(frame.replaceAll(root, ""));
			},
			{projectsDir, plansDir: ""},
		);
		return {counters: structuredClone(serverScope.currentPerfCounters()!), payloadBytes};
	});
}

/** Checks every count before failing, so one run records all of them in results.json for `just perf-ceilings`. */
function ratchetAll(values: Record<string, number>): void {
	const failures: string[] = [];
	for (const [id, value] of Object.entries(values)) {
		try {
			ratchet(id, value);
		} catch (error) {
			failures.push((error as Error).message);
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
}

describe("server lab: live append to one session", () => {
	for (const shape of perfShapes()) {
		it(shape.name, async () => {
			const file = files.get(shape.name)!;
			const sessionId = basename(file, ".jsonl");
			// Steady state: the watcher has caught up with the file and snapshotted the project's sessions.
			offsets.set(file, statSync(file).size);
			await fire(file);

			const values: Record<string, number> = {};
			for (const [batch, count] of LIVE_APPEND_SIZES.entries()) {
				const text = appendedLines(sessionId, count, batch);
				appendFileSync(file, text);
				const {counters, payloadBytes} = await fire(file);
				Object.assign(
					values,
					metricIds<LiveAppendMetric>(liveAppendPrefix(shape.name, count), {
						readAmplification: Math.round(counters.jsonl.bytesRead / Buffer.byteLength(text)),
						"jsonl.fullScans": counters.jsonl.fullScans,
						"sql.count": counters.sql.count,
						"sse.payloadBytes": payloadBytes,
					}),
				);
			}
			ratchetAll(values);
		});
	}
});

/** Five agents writing at once into one project, each session a distinct small transcript. */
const MULTI_PROJECT = "-multi";
const MULTI_SEEDS = [2, 3, 4, 5, 6] as const;
/** Lines each session appends, interleaved round-robin across the sessions within one throttle window. */
const MULTI_ROUNDS = 4;
/** Open tabs, each an SSE client that receives every broadcast. */
const MULTI_TABS = 3;

describe("server lab: live append to five sessions at once", () => {
	const multiFiles: string[] = [];
	const tabs: ReadableStreamDefaultController[] = [];

	beforeAll(async () => {
		mkdirSync(join(projectsDir, MULTI_PROJECT), {recursive: true});
		for (const seed of MULTI_SEEDS) {
			const cached = await generateTranscript(PERF_SHAPES.small, seed);
			const file = join(projectsDir, MULTI_PROJECT, basename(cached));
			copyFileSync(cached, file);
			await indexJsonlFile(db.index, file, MULTI_PROJECT);
			multiFiles.push(file);
		}
		for (let tab = 0; tab < MULTI_TABS; tab++) {
			const controller = {enqueue: () => {}} as unknown as ReadableStreamDefaultController;
			tabs.push(controller);
			sseBroadcast.addClient(controller);
		}
	}, 600_000);

	afterAll(() => {
		for (const controller of tabs) sseBroadcast.removeClient(controller);
		sseBroadcast.resetSseStats();
	});

	it("interleaved appends within one throttle window", async () => {
		// Steady state: the watcher has caught up with every file and snapshotted the project's sessions.
		for (const file of multiFiles) {
			offsets.set(file, statSync(file).size);
			await fire(file);
		}

		for (let round = 0; round < MULTI_ROUNDS; round++) {
			for (const file of multiFiles) {
				appendFileSync(file, appendedLines(basename(file, ".jsonl"), 1, round));
			}
		}

		// The throttle collapses each file's appends in the window into one trailing fire per file.
		sseBroadcast.resetSseStats();
		const counters = await serverScope.withPerfScope("live-append-multi", async () => {
			for (const file of multiFiles) {
				await watcher.processJsonlAppend(
					db.index,
					file,
					offsets,
					(type, data) => {
						// Drop the temp root so the delivered size is the same on every machine.
						sseBroadcast.broadcastTyped(type, JSON.parse(JSON.stringify(data).replaceAll(root, "")));
					},
					{projectsDir, plansDir: ""},
				);
			}
			return structuredClone(serverScope.currentPerfCounters()!);
		});
		const deliveredBytes = Object.values(sseBroadcast.getSseStats()).reduce(
			(sum, entry) => sum + entry.deliveredBytes,
			0,
		);

		ratchetAll(
			metricIds<LiveAppendMultiMetric>(LIVE_APPEND_MULTI_PREFIX, {
				"jsonl.bytesRead": counters.jsonl.bytesRead,
				"jsonl.fullScans": counters.jsonl.fullScans,
				"sse.deliveredBytes": deliveredBytes,
			}),
		);
	});
});
