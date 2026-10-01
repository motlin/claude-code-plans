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
// file. No single synchronous stretch of indexing that burst may hold up requests and SSE streams for longer than this.
// One file's FTS write cannot be split, and an FTS segment merge or WAL checkpoint inside it occasionally takes tens of
// milliseconds, so the budget sits well under the server's 500 ms stall log threshold rather than at the slice length.
const SLICE_BUDGET_MS = 250;
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
			stopMonitor();
		}

		const rows = db.index.all(sql`SELECT path, content FROM file_content_fts ORDER BY path`);
		const matches = db.index.all(
			sql`SELECT path FROM file_content_fts WHERE file_content_fts MATCH ${"generation2"} ORDER BY path`,
		);
		expect({
			withinBudget: longestStallMs <= SLICE_BUDGET_MS || Math.round(longestStallMs),
			rows,
			matches,
		}).toStrictEqual({
			withinBudget: true,
			rows: filePaths.map((path, fileIndex) => ({path, content: fileText(fileIndex, 2)})),
			matches: filePaths.map((path) => ({path})),
		});
	}, 60_000);
});
