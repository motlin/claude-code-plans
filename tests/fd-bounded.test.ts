import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {execFileSync} from "node:child_process";
import fs, {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {fullScan} from "../src/lib/db/indexer";
import {createRecursiveWatcher} from "../src/lib/recursive-watch";
import {readFirstUserMessage, readNewJsonlLines} from "../src/lib/sessions";
import {processJsonlAppend} from "../src/lib/watcher";

const SESSION_COUNT = 8;
const APPENDS_PER_SESSION = 4;

function openPaths(): string[] {
	if (process.platform === "linux") {
		return readdirSync("/proc/self/fd").flatMap((fd) => {
			try {
				return [readlinkSync(`/proc/self/fd/${fd}`)];
			} catch {
				return [];
			}
		});
	}
	// -b skips lsof's stat of every mount point, which blocks for its 15s kernel-call timeout whenever a network
	// mount (an SMB or Time Machine share) is slow to answer. Descriptor paths still come from the kernel.
	const lsof = execFileSync("lsof", ["-b", "-w", "-n", "-P", "-p", String(process.pid), "-Fn"], {encoding: "utf8"});
	return lsof
		.split("\n")
		.filter((line) => line.startsWith("n"))
		.map((line) => line.slice(1));
}

/**
 * Paths this process holds open inside `root`. Counting only the test's own tree keeps
 * descriptors the test runner or other in-process work opens out of the assertion.
 */
function openPathsUnder(root: string): string[] {
	const realRoot = realpathSync(root);
	return openPaths()
		.filter((path) => path === realRoot || path.startsWith(`${realRoot}/`))
		.sort();
}

/**
 * Holds every `fs.close` back by `delayMs`, as a libuv threadpool busy with other work does, and counts the closes
 * still in flight. File streams close their descriptor through the `fs` module object.
 */
function delayDescriptorCloses(delayMs: number): {inFlight: () => number; restore: () => void} {
	const close = fs.close;
	let inFlight = 0;
	fs.close = ((fd: number, callback?: (error: NodeJS.ErrnoException | null) => void) => {
		inFlight++;
		setTimeout(() => {
			close(fd, (error) => {
				inFlight--;
				callback?.(error);
			});
		}, delayMs);
	}) as typeof fs.close;
	return {
		inFlight: () => inFlight,
		restore: () => {
			fs.close = close;
		},
	};
}

/** Native fs.watch handles held by this process. */
function activeWatchers(): number {
	return process.getActiveResourcesInfo().filter((resource) => resource === "FSEventWrap").length;
}

function record(sessionId: string, index: number, content: string): string {
	return `${JSON.stringify({
		type: index % 2 === 0 ? "user" : "assistant",
		uuid: `${sessionId}-${index}`,
		sessionId,
		timestamp: new Date(Date.UTC(2000, 0, 1, 0, 0, index)).toISOString(),
		message: {role: index % 2 === 0 ? "user" : "assistant", content},
	})}\n`;
}

/** A transcript well past one 64 KiB read-stream chunk, so a reader that stops early leaves bytes unread. */
function largeTranscript(sessionId: string): string {
	let text = "";
	for (let index = 0; index < 400; index++) text += record(sessionId, index, `line ${index} ${"x".repeat(400)}`);
	return text;
}

describe("file descriptors stay bounded while indexing and tailing many transcripts", () => {
	let root: string;
	let db: AppDb;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ccp-fd-bounded-"));
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(root, {recursive: true, force: true});
	});

	it("closes every transcript it opens across a full scan and repeated appends", async () => {
		const projectsDir = join(root, "projects");
		const plansDir = join(root, "plans");
		const tasksDir = join(root, "tasks");
		const projectDir = join(projectsDir, "-Users-alice-projects-many");
		mkdirSync(projectDir, {recursive: true});
		mkdirSync(plansDir, {recursive: true});
		mkdirSync(tasksDir, {recursive: true});
		const paths = Array.from({length: SESSION_COUNT}, (_, index) => {
			const sessionId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
			const path = join(projectDir, `${sessionId}.jsonl`);
			writeFileSync(path, largeTranscript(sessionId));
			return {sessionId, path};
		});

		await fullScan(db.index, db.summaries, projectsDir, tasksDir, plansDir);

		const offsets = new Map<string, number>();
		const ignoreBroadcast = () => {};
		for (let round = 0; round < APPENDS_PER_SESSION; round++) {
			for (const {sessionId, path} of paths) {
				appendFileSync(path, record(sessionId, 1000 + round, `appended ${round}`));
				// An unterminated tail is what a transcript looks like mid-write.
				if (round % 2 === 1) appendFileSync(path, '{"type":"user","partial');
				await processJsonlAppend(db.index, path, offsets, ignoreBroadcast, {projectsDir, plansDir});
			}
		}

		expect(openPathsUnder(root)).toStrictEqual([]);
	});

	it("resolves a transcript read only once its descriptor has closed, however long the close takes", async () => {
		const sessionId = "00000000-0000-4000-8000-000000000000";
		const path = join(root, `${sessionId}.jsonl`);
		writeFileSync(path, `${largeTranscript(sessionId)}{"type":"user","partial`);
		const closes = delayDescriptorCloses(100);
		try {
			const inFlightAfterTail = await readNewJsonlLines(path, 0).then(() => closes.inFlight());
			const inFlightAfterEarlyExit = await readFirstUserMessage(path).then(() => closes.inFlight());
			expect({inFlightAfterTail, inFlightAfterEarlyExit}).toStrictEqual({
				inFlightAfterTail: 0,
				inFlightAfterEarlyExit: 0,
			});
		} finally {
			closes.restore();
		}
	});
});

describe("the recursive watcher", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ccp-watch-bounded-"));
	});

	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it("holds descriptors per watched directory rather than per file, and releases them all on close", async () => {
		const projectsDir = join(root, "projects");
		const directories = 3;
		for (let directory = 0; directory < directories; directory++) {
			const projectDir = join(projectsDir, `project-${directory}`);
			mkdirSync(projectDir, {recursive: true});
			for (let file = 0; file < 200; file++) writeFileSync(join(projectDir, `session-${file}.jsonl`), "{}\n");
		}
		const baselineWatchers = activeWatchers();

		const watcher = createRecursiveWatcher([projectsDir], () => false);
		await new Promise<void>((resolve) => {
			watcher.once("ready", resolve);
		});
		const whileWatching = {descriptors: openPathsUnder(root).length, watchers: activeWatchers() - baselineWatchers};

		await watcher.close();
		// Native watch handles finish closing on a later tick, so wait for them rather than for a fixed time.
		await expect.poll(() => activeWatchers() - baselineWatchers, {timeout: 10_000}).toBe(0);

		expect({
			whileWatching: {
				perDirectory: whileWatching.descriptors <= directories + 1,
				watching: whileWatching.watchers > 0,
			},
			afterClose: {descriptors: openPathsUnder(root), watchers: activeWatchers() - baselineWatchers},
		}).toStrictEqual({
			whileWatching: {perDirectory: true, watching: true},
			afterClose: {descriptors: [], watchers: 0},
		});
	});
});
