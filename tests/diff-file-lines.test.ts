import {getSingularPatch} from "@pierre/diffs";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {
	commentsNeedWholeFile,
	countFileLines,
	loadWithRetry,
	RETRY_DELAYS,
	toLoadedFiles,
	wholeFileState,
	type LoadAttemptResult,
} from "../src/components/changes/diff-file-lines";

/** Last hunk ends at new line 5 and old line 4. */
const PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -2,3 +2,4 @@
 two
-three
+THREE
+three-and-a-half
 four
`;

const RENAME_PATCH = `diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`;

function lines(count: number): string {
	return Array.from({length: count}, (_, index) => `line ${index + 1}\n`).join("");
}

describe("countFileLines (upstream pa)", () => {
	it("counts lines without counting a trailing newline as one", () => {
		expect(["", "a", "a\n", "a\nb", "a\nb\n", "\n"].map(countFileLines)).toStrictEqual([0, 1, 1, 2, 2, 1]);
	});
});

describe("toLoadedFiles (upstream ma)", () => {
	const fileDiff = getSingularPatch(PATCH);

	it("validates loaded sides against the patch", () => {
		expect([
			toLoadedFiles(fileDiff, {path: "src/a.ts"}, {oldText: lines(7), newText: null}),
			toLoadedFiles(fileDiff, {path: "src/a.ts"}, {oldText: null, newText: lines(9)}),
			toLoadedFiles(fileDiff, {path: "src/a.ts"}, {oldText: lines(7), newText: lines(9)}),
			toLoadedFiles(fileDiff, {path: "src/a.ts"}, {oldText: lines(3), newText: lines(4)}),
			toLoadedFiles(fileDiff, {path: "src/a.ts", oldPath: "src/was.ts"}, {oldText: lines(7), newText: lines(8)}),
		]).toStrictEqual([
			"unavailable",
			"unavailable",
			"drifted",
			"drifted",
			{
				oldFile: {name: "src/was.ts", contents: lines(7)},
				newFile: {name: "src/a.ts", contents: lines(8)},
			},
		]);
	});

	it("needs only the new side of a pure rename", () => {
		expect(
			toLoadedFiles(
				getSingularPatch(RENAME_PATCH),
				{path: "src/new.ts", oldPath: "src/old.ts"},
				{oldText: null, newText: "x\n"},
			),
		).toStrictEqual({oldFile: null, newFile: {name: "src/new.ts", contents: "x\n"}});
	});
});

describe("loadWithRetry (upstream bd)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const FILES = {oldFile: {name: "a", contents: "a\n"}, newFile: {name: "a", contents: "b\n"}};
	const PENDING = Symbol("pending");

	async function settled<T>(promise: Promise<T>): Promise<T | typeof PENDING> {
		return Promise.race([promise, Promise.resolve(PENDING)]);
	}

	function scripted(results: LoadAttemptResult[]) {
		const freshFlags: boolean[] = [];
		const attempt = async (fresh: boolean) => {
			freshFlags.push(fresh);
			return Promise.resolve(results.shift() ?? "unavailable");
		};
		return {attempt, freshFlags};
	}

	it("backs off 2s, 4s, 30s, 30s, 60s", () => {
		expect(RETRY_DELAYS).toStrictEqual([2000, 4000, 30_000, 30_000, 60_000]);
	});

	it("resolves with the files, rerunning at once on again and fresh on every retry", async () => {
		const {attempt, freshFlags} = scripted(["again", "unavailable", FILES]);
		const onGiveUp = vi.fn<() => void>();
		const loading = loadWithRetry(attempt, onGiveUp);
		await vi.advanceTimersByTimeAsync(0);
		expect(freshFlags).toStrictEqual([false, false]);
		await vi.advanceTimersByTimeAsync(1999);
		expect(freshFlags).toStrictEqual([false, false]);
		await vi.advanceTimersByTimeAsync(1);
		expect({files: await loading, freshFlags, gaveUp: onGiveUp.mock.calls.length}).toStrictEqual({
			files: FILES,
			freshFlags: [false, false, true],
			gaveUp: 0,
		});
	});

	it("gives up after the last delay and never settles", async () => {
		const {attempt, freshFlags} = scripted([]);
		const onGiveUp = vi.fn<() => void>();
		const loading = loadWithRetry(attempt, onGiveUp);
		await vi.advanceTimersByTimeAsync(2000 + 4000 + 30_000 + 30_000 + 60_000);
		expect({
			result: await settled(loading),
			freshFlags,
			gaveUp: onGiveUp.mock.calls.length,
		}).toStrictEqual({
			result: PENDING,
			freshFlags: [false, true, true, true, true, true],
			gaveUp: 1,
		});
	});

	it("parks on drifted, or when the attempt throws past its retries, without retrying a park", async () => {
		const {attempt, freshFlags} = scripted(["drifted"]);
		const onGiveUp = vi.fn<() => void>();
		const loading = loadWithRetry(attempt, onGiveUp);
		await vi.advanceTimersByTimeAsync(200_000);
		expect({result: await settled(loading), freshFlags, gaveUp: onGiveUp.mock.calls.length}).toStrictEqual({
			result: PENDING,
			freshFlags: [false],
			gaveUp: 1,
		});

		const throwing = vi.fn<(fresh: boolean) => Promise<LoadAttemptResult>>(async () =>
			Promise.reject(new Error("offline")),
		);
		const throwingGiveUp = vi.fn<() => void>();
		const retrying = loadWithRetry(throwing, throwingGiveUp);
		await vi.advanceTimersByTimeAsync(200_000);
		expect({
			result: await settled(retrying),
			calls: throwing.mock.calls.length,
			gaveUp: throwingGiveUp.mock.calls.length,
		}).toStrictEqual({result: PENDING, calls: 6, gaveUp: 1});
	});
});

describe("commentsNeedWholeFile (upstream Id/Nd)", () => {
	const fileDiff = getSingularPatch(PATCH);

	it("is true when a comment sits on a line outside every hunk", () => {
		expect([
			commentsNeedWholeFile(fileDiff, []),
			commentsNeedWholeFile(fileDiff, [{side: "additions", line: 2}]),
			commentsNeedWholeFile(fileDiff, [{side: "additions", line: 5}]),
			commentsNeedWholeFile(fileDiff, [{side: "additions", line: 6}]),
			commentsNeedWholeFile(fileDiff, [{side: "deletions", line: 4}]),
			commentsNeedWholeFile(fileDiff, [{side: "deletions", line: 5}]),
			commentsNeedWholeFile(fileDiff, [
				{side: "additions", line: 3},
				{side: "deletions", line: 1},
			]),
		]).toStrictEqual([false, false, false, true, false, true, true]);
	});
});

describe("wholeFileState (upstream Fo wholeFile)", () => {
	const base = {
		offered: true,
		hasHunks: true,
		status: "modified" as const,
		loaderGaveUp: false,
		shown: false,
		locked: false,
	};

	it("says whether, and how, the whole-file toggle is offered", () => {
		expect([
			wholeFileState({...base, offered: false}),
			wholeFileState({...base, hasHunks: false}),
			wholeFileState({...base, status: "added"}),
			wholeFileState({...base, status: "deleted"}),
			wholeFileState({...base, loaderGaveUp: true, shown: true}),
			wholeFileState({...base, shown: true, locked: true}),
			wholeFileState({...base, shown: true}),
			wholeFileState(base),
			wholeFileState({...base, status: "renamed"}),
		]).toStrictEqual([undefined, undefined, undefined, undefined, "unread", "locked", "shown", "folded", "folded"]);
	});
});
