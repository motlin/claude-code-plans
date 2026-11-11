// @vitest-environment jsdom

import {createHash} from "node:crypto";
import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {
	type DiffMarkScope,
	type MarkBurst,
	canMarkPatch,
	fileMarkStatus,
	notifyPatchChanges,
	patchFingerprint,
	setFileMarked,
	subscribeMarkChanges,
	useFileMark,
} from "../src/lib/diff-file-marks";
import {sha256Hex} from "../src/lib/sha256";
import {installLocalStorage} from "./fake-storage";

function nodeSha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

const FULL_OLD = "1".repeat(40);
const FULL_NEW = "2".repeat(40);

const HUNK_PATCH = `diff --git a/a.ts b/a.ts
index abc1234..def5678 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 a
-b
+c
+d
`;

const MODE_PATCH = "diff --git a/x b/x\nold mode 100644\nnew mode 100755\n";

describe("sha256Hex", () => {
	it("matches node:crypto for empty, ASCII, multi-block and non-ASCII input", () => {
		const inputs = ["", "abc", "x".repeat(1000), "naïve ☃ 🎉\nline two", "a".repeat(55), "a".repeat(56)];
		expect(inputs.map(sha256Hex)).toStrictEqual(inputs.map(nodeSha256));
	});
});

describe("canMarkPatch (upstream ss / au)", () => {
	it("needs exactly one file with a hunk, a full index line, or mode/rename lines without an index line", () => {
		expect({
			empty: canMarkPatch(""),
			null: canMarkPatch(null),
			twoFiles: canMarkPatch(`${HUNK_PATCH}\ndiff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-x\n+y\n`),
			hunk: canMarkPatch(HUNK_PATCH),
			modeOnly: canMarkPatch(MODE_PATCH),
			shortIndexOnly: canMarkPatch("diff --git a/x b/x\nindex abc1234..def5678\n"),
			fullIndexOnly: canMarkPatch(`diff --git a/x b/x\nindex ${FULL_OLD}..${FULL_NEW}\n`),
			modeWithShortIndex: canMarkPatch(
				"diff --git a/x b/x\nold mode 100644\nnew mode 100755\nindex abc1234..def5678\n",
			),
		}).toStrictEqual({
			empty: false,
			null: false,
			twoFiles: false,
			hunk: true,
			modeOnly: true,
			shortIndexOnly: false,
			fullIndexOnly: true,
			modeWithShortIndex: false,
		});
	});
});

describe("patchFingerprint (upstream fs / uu)", () => {
	it("hashes the kept header lines and the hunks with normalised @@ headers", () => {
		expect(patchFingerprint(HUNK_PATCH)).toBe(
			`sha256:${nodeSha256(["@@ 1,2 1,3", " a", "-b", "+c", "+d"].join("\n"))}`,
		);
	});

	it("ignores the index line and the hunk's section heading, but not the changed lines", () => {
		const base = patchFingerprint(HUNK_PATCH);
		expect({
			index: patchFingerprint(HUNK_PATCH.replace("abc1234..def5678", `${FULL_OLD}..${FULL_NEW}`)) === base,
			heading: patchFingerprint(HUNK_PATCH.replace("@@ -1,2 +1,3 @@", "@@ -1,2 +1,3 @@ function f()")) === base,
			added: patchFingerprint(HUNK_PATCH.replace("+d", "+e")) === base,
		}).toStrictEqual({index: true, heading: true, added: false});
	});

	it("keeps the first three digits of a new or deleted file mode, and defaults a hunk count to 1", () => {
		const patch =
			"diff --git a/n b/n\nnew file mode 100644\nindex 0000000..1234567\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+x\n";
		expect(patchFingerprint(patch)).toBe(`sha256:${nodeSha256(["new file 100", "@@ 0,0 1,1", "+x"].join("\n"))}`);
	});

	it("uses the full index ids for a hunkless patch, else hashes its mode lines", () => {
		const ids = `diff --git a/x b/x\nold mode 100644\nnew mode 100755\nindex ${FULL_OLD}..${FULL_NEW}\n`;
		expect({
			ids: patchFingerprint(ids),
			mode: patchFingerprint(MODE_PATCH),
			unmarkable: patchFingerprint("diff --git a/x b/x\nindex abc1234..def5678\n"),
		}).toStrictEqual({
			ids: `ids:${FULL_OLD}..${FULL_NEW}\nold mode 100644\nnew mode 100755`,
			mode: `sha256:${nodeSha256("old mode 100644\nnew mode 100755")}`,
			unmarkable: null,
		});
	});
});

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);
const DAY = 86_400_000;
const BRANCH = JSON.stringify(["branch", "main", "feat"]);
const UNCOMMITTED = JSON.stringify(["uncommitted", "main", "feat"]);
const SCOPE: DiffMarkScope = {sessionId: "S", repo: "/repo", diff: BRANCH};
const UNCOMMITTED_SCOPE: DiffMarkScope = {...SCOPE, diff: UNCOMMITTED};
const CHANGED_PATCH = HUNK_PATCH.replace("+d", "+e");

function stored(): unknown {
	return JSON.parse(localStorage.getItem("diff-file-marks") ?? "null");
}

function record(overrides: Record<string, unknown> = {}) {
	return {repo: "/repo", filePath: "a.ts", diff: BRANCH, fingerprint: "sha256:feed", at: NOW - DAY, ...overrides};
}

function seed(marks: Record<string, unknown>): void {
	localStorage.setItem("diff-file-marks", JSON.stringify({state: {marks}, version: 0}));
}

describe("the diff-file-marks store (upstream Du / Ps / Fs)", () => {
	beforeEach(() => {
		installLocalStorage();
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("persists a mark as zustand's persist JSON under diff-file-marks", () => {
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, true);
		expect(stored()).toStrictEqual({
			state: {
				marks: {
					S: [
						{
							repo: "/repo",
							filePath: "a.ts",
							diff: BRANCH,
							fingerprint: patchFingerprint(HUNK_PATCH),
							at: NOW,
						},
					],
				},
			},
			version: 0,
		});
	});

	it("reads marked, stale after a patch change, none elsewhere, and marked for the same patch in another scope", () => {
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, true);
		expect({
			marked: fileMarkStatus(SCOPE, "a.ts", HUNK_PATCH),
			stale: fileMarkStatus(SCOPE, "a.ts", CHANGED_PATCH),
			otherScopeOtherPatch: fileMarkStatus(UNCOMMITTED_SCOPE, "a.ts", CHANGED_PATCH),
			otherScopeSamePatch: fileMarkStatus(UNCOMMITTED_SCOPE, "a.ts", HUNK_PATCH),
			otherFile: fileMarkStatus(SCOPE, "b.ts", HUNK_PATCH),
			otherRepo: fileMarkStatus({...SCOPE, repo: "/other"}, "a.ts", HUNK_PATCH),
		}).toStrictEqual({
			marked: "marked",
			stale: "stale",
			otherScopeOtherPatch: "none",
			otherScopeSamePatch: "marked",
			otherFile: "none",
			otherRepo: "none",
		});
	});

	it("does nothing when marking a patch that can't be fingerprinted", () => {
		setFileMarked(SCOPE, "a.ts", "diff --git a/x b/x\nindex abc1234..def5678\n", true);
		expect(localStorage.getItem("diff-file-marks")).toBeNull();
	});

	it("unmarks this diff's record and any with the same fingerprint, keeping other diffs' records", () => {
		const fingerprint = patchFingerprint(HUNK_PATCH);
		seed({
			S: [
				record({diff: BRANCH, fingerprint: "sha256:old"}),
				record({diff: UNCOMMITTED, fingerprint}),
				record({diff: "other", fingerprint: "sha256:kept"}),
				record({filePath: "b.ts", diff: BRANCH, fingerprint}),
			],
		});
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, false);
		expect(stored()).toStrictEqual({
			state: {
				marks: {
					S: [
						record({diff: "other", fingerprint: "sha256:kept"}),
						record({filePath: "b.ts", diff: BRANCH, fingerprint}),
					],
				},
			},
			version: 0,
		});
	});

	it("drops future, 45-day-old and malformed records on read", () => {
		const fingerprint = patchFingerprint(HUNK_PATCH);
		seed({
			S: [
				record({fingerprint, at: NOW + 1}),
				record({fingerprint, at: NOW - 3888e6 - 1}),
				record({fingerprint, at: "yesterday"}),
				{repo: "/repo", filePath: "a.ts"},
				"junk",
			],
			T: "not an array",
		});
		setFileMarked(SCOPE, "b.ts", HUNK_PATCH, true);
		expect({
			status: fileMarkStatus(SCOPE, "a.ts", HUNK_PATCH),
			stored: stored(),
		}).toStrictEqual({
			status: "none",
			stored: {state: {marks: {S: [record({filePath: "b.ts", fingerprint, at: NOW})]}}, version: 0},
		});
	});

	it("keeps 45-day-old-to-the-millisecond records", () => {
		seed({S: [record({fingerprint: patchFingerprint(HUNK_PATCH), at: NOW - 3888e6})]});
		expect(fileMarkStatus(SCOPE, "a.ts", HUNK_PATCH)).toBe("marked");
	});

	it("prunes to the 2000 newest marks and then the 50 sessions with the newest marks", () => {
		const marks: Record<string, unknown> = {};
		for (let session = 0; session < 60; session++) {
			marks[`S${String(session)}`] = Array.from({length: 40}, (_, index) =>
				record({filePath: `f${String(index)}`, at: NOW - DAY + session * 100 + index}),
			);
		}
		seed(marks);
		setFileMarked({...SCOPE, sessionId: "S59"}, "new.ts", HUNK_PATCH, true);
		const state = stored() as {state: {marks: Record<string, {at: number}[]>}};
		const sessions = Object.keys(state.state.marks);
		const total = Object.values(state.state.marks).reduce((sum, list) => sum + list.length, 0);
		expect({
			sessions: sessions.length,
			total,
			first: sessions[0],
			oldestKept: sessions.includes("S10"),
			newestDropped: sessions.includes("S9"),
		}).toStrictEqual({sessions: 50, total: 2000, first: "S59", oldestKept: true, newestDropped: false});
	});

	it("notifies mark listeners on mark and on unmarking an existing match only", () => {
		const listener = vi.fn<(scope: DiffMarkScope, path: string, marked: boolean) => void>();
		const unsubscribe = subscribeMarkChanges(listener);
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, true);
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, false);
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, false);
		unsubscribe();
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, true);
		expect(listener.mock.calls).toStrictEqual([
			[SCOPE, "a.ts", true],
			[SCOPE, "a.ts", false],
		]);
	});

	it("tells listeners a marked file is no longer marked when its patch changes, sharing one burst (upstream Is)", () => {
		setFileMarked(SCOPE, "a.ts", HUNK_PATCH, true);
		setFileMarked(SCOPE, "b.ts", HUNK_PATCH, true);
		setFileMarked(SCOPE, "d.ts", HUNK_PATCH, true);
		const listener = vi.fn<(scope: DiffMarkScope, path: string, marked: boolean, burst?: MarkBurst) => void>();
		const unsubscribe = subscribeMarkChanges(listener);
		notifyPatchChanges(
			SCOPE,
			new Map([
				["a.ts", HUNK_PATCH],
				["b.ts", HUNK_PATCH],
				["c.ts", HUNK_PATCH],
				["d.ts", HUNK_PATCH],
			]),
			new Map([
				["a.ts", CHANGED_PATCH],
				["b.ts", HUNK_PATCH],
				["c.ts", CHANGED_PATCH],
				["d.ts", CHANGED_PATCH],
			]),
		);
		unsubscribe();
		expect({
			calls: listener.mock.calls,
			sameBurst: listener.mock.calls[0]?.[3] === listener.mock.calls[1]?.[3],
		}).toStrictEqual({
			calls: [
				[SCOPE, "a.ts", false, {held: false}],
				[SCOPE, "d.ts", false, {held: false}],
			],
			sameBurst: true,
		});
	});
});

describe("useFileMark", () => {
	beforeEach(() => {
		installLocalStorage();
	});

	it("is undefined without a scope or for a synthetic row, and tracks marks from this tab and others", () => {
		const none = renderHook(() => useFileMark(undefined, "a.ts", HUNK_PATCH)).result.current;
		const synthetic = renderHook(() => useFileMark(SCOPE, "… 3 more files", HUNK_PATCH)).result.current;
		const {result} = renderHook(() => useFileMark(SCOPE, "a.ts", HUNK_PATCH));
		const before = result.current?.status;
		act(() => {
			result.current?.setMarked(true);
		});
		const afterMark = result.current?.status;
		act(() => {
			localStorage.removeItem("diff-file-marks");
			window.dispatchEvent(new StorageEvent("storage", {key: "diff-file-marks"}));
		});
		expect({
			none,
			synthetic,
			before,
			afterMark,
			afterOtherTab: result.current?.status,
			canMark: result.current?.canMark,
		}).toStrictEqual({
			none: undefined,
			synthetic: undefined,
			before: "none",
			afterMark: "marked",
			afterOtherTab: "none",
			canMark: true,
		});
	});

	it("reports an unmarkable patch as canMark false and ignores setMarked(true)", () => {
		const {result} = renderHook(() => useFileMark(SCOPE, "a.ts", null));
		act(() => {
			result.current?.setMarked(true);
		});
		expect({
			status: result.current?.status,
			canMark: result.current?.canMark,
			stored: localStorage.getItem("diff-file-marks"),
		}).toStrictEqual({status: "none", canMark: false, stored: null});
	});
});
