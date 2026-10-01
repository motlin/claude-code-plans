import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sql} from "drizzle-orm";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {openAppDb, type AppDb} from "../../src/lib/db/connection";
import {hmrPersist} from "../../src/lib/hmr-persist";
import {startStallMonitor} from "../../src/lib/perf/event-loop-stalls";
import {__testing as watcherTesting} from "../../src/lib/watcher";
import {runGit} from "../git-fixture";

// A git checkout or rebase rewrites hundreds of tracked files at once, and the watcher fires one change event per
// file. Indexing that burst must hand the event loop back to requests and SSE streams between files, so no loop turn
// may run more than one file's FTS write. Wall-clock stall lengths swing with machine load, so they are only a loose
// backstop here; the per-turn write count is the load-independent assertion.
const STALL_BACKSTOP_MS = 1000;
const FILE_COUNT = 400;
const WORDS_PER_FILE = 4000;

function fileText(fileIndex: number, generation: number): string {
	const words: string[] = [];
	for (let wordIndex = 0; wordIndex < WORDS_PER_FILE; wordIndex++) {
		words.push(`term${(fileIndex * 7919 + wordIndex * 104_729 + generation) % 50_000}`);
	}
	return `generation${generation} file${fileIndex}\n${words.join(" ")}\n`;
}

describe("file content indexing and the event loop", () => {
	let fixtureDirectory: string;
	let repositoryDirectory: string;
	let db: AppDb;
	const dbHolder = hmrPersist<{db: AppDb | null}>("appDbHolder", () => ({db: null}));

	beforeEach(() => {
		fixtureDirectory = realpathSync(mkdtempSync(join(tmpdir(), "file-content-event-loop-")));
		repositoryDirectory = join(fixtureDirectory, "repository");
		mkdirSync(repositoryDirectory);
		runGit(repositoryDirectory, ["init", "--quiet", "--initial-branch=main"]);
		db = openAppDb({cacheDir: join(fixtureDirectory, "cache")});
		dbHolder.db = db;
		watcherTesting.setFileContentRoots([repositoryDirectory]);
	});

	afterEach(() => {
		watcherTesting.setFileContentRoots([]);
		dbHolder.db = null;
		db.close();
		rmSync(fixtureDirectory, {recursive: true, force: true});
	});

	it("indexes a burst of watcher change events in short slices", async () => {
		const filePaths = Array.from({length: FILE_COUNT}, (_, fileIndex) =>
			join(repositoryDirectory, `file-${String(fileIndex).padStart(4, "0")}.txt`),
		);
		for (const [fileIndex, filePath] of filePaths.entries()) writeFileSync(filePath, fileText(fileIndex, 1));
		runGit(repositoryDirectory, ["add", "."]);
		await watcherTesting.handleFileChange(join(repositoryDirectory, ".git", "index"));

		for (const [fileIndex, filePath] of filePaths.entries()) writeFileSync(filePath, fileText(fileIndex, 2));
		let loopTurn = 0;
		let turnOfLastWrite = -1;
		let writesInTurn = 0;
		let maxWritesPerLoopTurn = 0;
		db.index.$client.function("note_file_content_write", () => {
			writesInTurn = loopTurn === turnOfLastWrite ? writesInTurn + 1 : 1;
			turnOfLastWrite = loopTurn;
			maxWritesPerLoopTurn = Math.max(maxWritesPerLoopTurn, writesInTurn);
			return null;
		});
		db.index.$client.exec(
			"CREATE TEMP TRIGGER note_file_content_write AFTER INSERT ON file_content BEGIN SELECT note_file_content_write(); END",
		);
		let countingTurns = true;
		const countTurn = (): void => {
			loopTurn++;
			if (countingTurns) setImmediate(countTurn);
		};
		setImmediate(countTurn);

		let longestStallMs = 0;
		const stopMonitor = startStallMonitor({
			thresholdMs: 0,
			intervalMs: 5,
			onStall: (stall) => {
				longestStallMs = Math.max(longestStallMs, stall.durationMs);
			},
		});
		try {
			await Promise.all(filePaths.map((filePath) => watcherTesting.handleFileChange(filePath)));
			await new Promise((resolve) => setTimeout(resolve, 20));
		} finally {
			countingTurns = false;
			stopMonitor();
		}

		const rows = db.index.all(sql`SELECT path, content FROM file_content_fts ORDER BY path`);
		const matches = db.index.all(
			sql`SELECT path FROM file_content_fts WHERE file_content_fts MATCH ${"generation2"} ORDER BY path`,
		);
		expect({
			maxWritesPerLoopTurn,
			withinBackstop: longestStallMs <= STALL_BACKSTOP_MS || Math.round(longestStallMs),
			rows,
			matches,
		}).toStrictEqual({
			maxWritesPerLoopTurn: 1,
			withinBackstop: true,
			rows: filePaths.map((path, fileIndex) => ({path, content: fileText(fileIndex, 2)})),
			matches: filePaths.map((path) => ({path})),
		});
	}, 60_000);
});
