import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {fullScan} from "../src/lib/db/indexer";
import {createRecursiveWatcher} from "../src/lib/recursive-watch";
import {processJsonlAppend} from "../src/lib/watcher";

const SESSION_COUNT = 30;
const APPENDS_PER_SESSION = 4;

function openFileDescriptorCount(): number {
	return readdirSync("/dev/fd").length;
}

/** Active filesystem handles and requests: watchers, open file handles and pending fs calls. */
function activeFsResources(): string[] {
	return process
		.getActiveResourcesInfo()
		.filter((resource) => resource.startsWith("FS") || resource === "FileHandle")
		.sort();
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

		const baseline = openFileDescriptorCount();
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
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(openFileDescriptorCount() - baseline).toBeLessThanOrEqual(2);
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
		const baselineDescriptors = openFileDescriptorCount();
		const baselineResources = activeFsResources();

		const watcher = createRecursiveWatcher([projectsDir], () => false);
		await new Promise<void>((resolve) => watcher.once("ready", resolve));
		expect(openFileDescriptorCount() - baselineDescriptors).toBeLessThanOrEqual(directories + 1);
		expect(activeFsResources().length - baselineResources.length).toBeGreaterThan(0);

		await watcher.close();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(openFileDescriptorCount()).toBe(baselineDescriptors);
		expect(activeFsResources()).toStrictEqual(baselineResources);
	});
});
