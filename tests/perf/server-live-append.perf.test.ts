import {afterAll, beforeAll, describe, it, vi} from "vite-plus/test";
import {appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import type {AppDb} from "../../src/lib/db/connection";
import type {PerfCounters} from "../../src/lib/perf/server-scope";
import {generateTranscript, perfShapes, seedFixtureDb} from "./fixtures/generate-transcript";
import {LIVE_APPEND_SIZES, type LiveAppendMetric, liveAppendPrefix, metricIds} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Server lab benchmark for a live append to one active session (measurement plan §2.4 L3, §7 decision 5). Drives the
 * watcher's JSONL fire body directly against a seeded fixture DB and ratchets what one append costs per fixture shape.
 * readAmplification is JSONL bytes read divided by bytes appended, so an incremental fire would read about 1.
 */

const PROJECT = "-repo";

let root: string;
let projectsDir: string;
let db: AppDb;
let serverScope: typeof import("../../src/lib/perf/server-scope");
let watcher: typeof import("../../src/lib/watcher");
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
