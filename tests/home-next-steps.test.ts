import {describe, expect, it} from "vite-plus/test";

import {
	blockedDismissLabel,
	blockedRestTitle,
	folderNextStepCandidates,
	type FolderNextStepSource,
	nextStepKey,
	prNextStepCandidates,
	reviewCommentsTitle,
	type PrNextStepSource,
	selectNextSteps,
	sessionRunningIn,
	type NextStepCandidate,
	type NextStepId,
} from "../src/lib/home-next-steps";

function candidate(id: NextStepId, subject: string, stamp = 100): NextStepCandidate {
	return {id, subject, stamp, title: subject, detail: null};
}

function blocked(n: number): NextStepCandidate[] {
	return Array.from({length: n}, (_, index) => candidate("waiting-session", `s${index + 1}`));
}

/** Each visible seat as row subjects, or the rest row's title and remaining subjects. */
function seats(candidates: NextStepCandidate[], dismissed: Record<string, number> = {}) {
	return selectNextSteps({candidates, dismissed}).map((row) =>
		row.type === "row"
			? row.candidate.subject
			: {title: row.title, dismissLabel: row.dismissLabel, rest: row.rest.map((c) => c.subject)},
	);
}

describe("selectNextSteps", () => {
	it("orders candidates by upstream priority and keeps three seats", () => {
		expect(
			seats([
				candidate("continue-branch", "branch"),
				candidate("pr-ci-failed", "pr"),
				candidate("worktree-apart", "folder"),
				candidate("waiting-session", "s1"),
			]),
		).toStrictEqual(["s1", "folder", "pr"]);
	});

	it("shows low-value rows only when nothing else qualifies", () => {
		expect(seats([candidate("cli-import", "cli"), candidate("waiting-session", "s1")])).toStrictEqual(["s1"]);
		expect(seats([candidate("cli-import", "cli")])).toStrictEqual(["cli"]);
	});

	it("shows up to three blocked sessions as rows", () => {
		expect(seats(blocked(3))).toStrictEqual(["s1", "s2", "s3"]);
	});

	it("folds a family past its seats into two rows and a plural 'more' row", () => {
		expect(seats(blocked(6))).toStrictEqual([
			"s1",
			"s2",
			{
				title: "Claude is blocked in 4 more sessions",
				dismissLabel: "Dismiss 4 blocked sessions",
				rest: ["s3", "s4", "s5", "s6"],
			},
		]);
	});

	it("gives a family the leftover seat, else one whole-family row", () => {
		expect(seats([...blocked(3), candidate("pr-ci-failed", "pr")])).toStrictEqual([
			"s1",
			{
				title: "Claude is blocked in 2 more sessions",
				dismissLabel: "Dismiss 2 blocked sessions",
				rest: ["s2", "s3"],
			},
			"pr",
		]);
		expect(seats([...blocked(2), candidate("pr-ci-failed", "pr"), candidate("worktree-apart", "f")])).toStrictEqual(
			[
				{
					title: "Claude is blocked in 2 sessions",
					dismissLabel: "Dismiss 2 blocked sessions",
					rest: ["s1", "s2"],
				},
				"f",
				"pr",
			],
		);
	});

	it("titles the rest row in the singular and plural", () => {
		expect(
			[1, 4].flatMap((n) => [blockedRestTitle(n, false), blockedRestTitle(n, true), blockedDismissLabel(n)]),
		).toStrictEqual([
			"Claude is blocked in 1 more session",
			"Claude is blocked in 1 session",
			"Dismiss 1 blocked session",
			"Claude is blocked in 4 more sessions",
			"Claude is blocked in 4 sessions",
			"Dismiss 4 blocked sessions",
		]);
	});

	it("hides a dismissed row until its stamp moves past the dismissal", () => {
		const s1 = candidate("waiting-session", "s1", 100);
		const dismissed = {[nextStepKey(s1)]: 150};
		expect(seats([s1, candidate("waiting-session", "s2")], dismissed)).toStrictEqual(["s2"]);
		expect(seats([{...s1, stamp: 200}, candidate("waiting-session", "s2")], dismissed)).toStrictEqual(["s1", "s2"]);
	});

	it("keys dismissals by row and subject", () => {
		expect(nextStepKey(candidate("waiting-session", "abc"))).toBe("next-step:waiting-session:abc");
	});
});

describe("PR next steps", () => {
	function pr(sessionId: string, failedChecks: number, overrides: Partial<PrNextStepSource> = {}): PrNextStepSource {
		return {
			sessionId,
			lastActivityAt: 500,
			title: `PR ${sessionId}`,
			failedChecks,
			failingChecks: [],
			unresolvedReviewThreads: 0,
			headBranch: null,
			...overrides,
		};
	}

	it("ranks a failing PR after a blocked session", () => {
		const rows = selectNextSteps({
			candidates: [...prNextStepCandidates([pr("p1", 2)]), ...blocked(1)],
			dismissed: {},
		});
		expect(
			rows.map((row) => (row.type === "row" ? [row.candidate.id, row.candidate.title] : row.title)),
		).toStrictEqual([
			["waiting-session", "s1"],
			["pr-ci-failed", "Fix the failing checks"],
		]);
	});

	it("turns each PR with failing checks into a 'Fix the failing checks' candidate", () => {
		expect(prNextStepCandidates([pr("p1", 1), pr("p2", 0), pr("p3", 3)])).toStrictEqual([
			{id: "pr-ci-failed", subject: "p1", stamp: 500, title: "Fix the failing checks", detail: "1 failing check"},
			{
				id: "pr-ci-failed",
				subject: "p3",
				stamp: 500,
				title: "Fix the failing checks",
				detail: "3 failing checks",
			},
		]);
	});

	it("ranks an 'Answer 2 review comments' row after 'Fix the failing checks'", () => {
		const rows = selectNextSteps({
			candidates: prNextStepCandidates([pr("p1", 0, {unresolvedReviewThreads: 2}), pr("p2", 1)]),
			dismissed: {},
		});
		expect(rows).toStrictEqual([
			{
				type: "row",
				candidate: {
					id: "pr-ci-failed",
					subject: "p2",
					stamp: 500,
					title: "Fix the failing checks",
					detail: "1 failing check",
				},
			},
			{
				type: "row",
				candidate: {
					id: "pr-review-comments",
					subject: "p1",
					stamp: 500,
					title: "Answer 2 review comments",
					detail: "PR p1",
				},
			},
		]);
	});

	it("names the failing check in the detail and says where it fails in the tooltip", () => {
		expect(
			prNextStepCandidates([
				pr("p1", 2, {failingChecks: ["test", "lint"], headBranch: "feature"}),
				pr("p2", 1, {failingChecks: ["build"]}),
			]),
		).toStrictEqual([
			{
				id: "pr-ci-failed",
				subject: "p1",
				stamp: 500,
				title: "Fix the failing checks",
				detail: "test",
				tooltip: "test is failing on feature.",
			},
			{id: "pr-ci-failed", subject: "p2", stamp: 500, title: "Fix the failing checks", detail: "build"},
		]);
	});

	it("titles review comments in the singular and plural", () => {
		expect([1, 4].map(reviewCommentsTitle)).toStrictEqual(["Answer 1 review comment", "Answer 4 review comments"]);
	});
});

describe("folder next steps", () => {
	const DIRTY = {isGitRepo: true, headBranch: "feat/x", defaultBranch: "main", uncommittedFiles: 3};
	const PROMPT =
		"Continue the work in progress on feat/x: look at the uncommitted changes, tell me what state they\u2019re in, and finish what\u2019s started.";
	const WORKTREE: NextStepCandidate = {
		id: "worktree-apart",
		kind: "worktree",
		subject: "/p",
		stamp: 0,
		title: "Turn on Worktree",
		detail: "Session running here",
		tooltipText:
			"Another session is running in this folder. Worktree gives this session its own copy, so their changes stay apart.",
		dismissLabel: "Dismiss the Worktree suggestion",
	};
	const CONTINUE: NextStepCandidate = {
		id: "continue-branch",
		kind: "prefill",
		subject: "/p\u0000feat/x\u00003",
		stamp: 0,
		title: "Continue uncommitted work",
		detail: "3 files",
		tooltipText: "3 uncommitted files on feat/x",
		dismissLabel: "Dismiss the uncommitted work",
		prefill: PROMPT,
	};

	function folder(overrides: Partial<FolderNextStepSource> = {}): NextStepCandidate[] {
		return folderNextStepCandidates({
			folder: "/p",
			git: DIRTY,
			runningHere: false,
			worktreeOn: false,
			worktreeTaken: false,
			used: new Set(),
			failed: null,
			launching: false,
			...overrides,
		});
	}

	it("suggests Worktree only for a git folder with a session running here and Worktree off", () => {
		expect(folder({git: {...DIRTY, uncommittedFiles: 0}, runningHere: true})).toStrictEqual([WORKTREE]);
		expect(folder({git: {...DIRTY, uncommittedFiles: 0}})).toStrictEqual([]);
		expect(
			folder({
				git: {isGitRepo: false, headBranch: null, defaultBranch: null, uncommittedFiles: 0},
				runningHere: true,
			}),
		).toStrictEqual([]);
		expect(folder({git: undefined, runningHere: true})).toStrictEqual([]);
		expect(folder({folder: undefined, runningHere: true})).toStrictEqual([]);
	});

	it("keeps a pressed Worktree row as taken, and drops it when Worktree was turned on elsewhere", () => {
		expect(
			folder({git: {...DIRTY, uncommittedFiles: 0}, runningHere: true, worktreeOn: true, worktreeTaken: true}),
		).toStrictEqual([{...WORKTREE, taken: true}]);
		expect(folder({git: {...DIRTY, uncommittedFiles: 0}, runningHere: true, worktreeOn: true})).toStrictEqual([]);
	});

	it("offers to continue uncommitted work on a non-default branch, with upstream's copy and plurals", () => {
		expect(folder()).toStrictEqual([CONTINUE]);
		expect(folder({git: {...DIRTY, uncommittedFiles: 1}})).toStrictEqual([
			{
				...CONTINUE,
				subject: "/p\u0000feat/x\u00001",
				detail: "1 file",
				tooltipText: "1 uncommitted file on feat/x",
			},
		]);
		expect(folder({git: {...DIRTY, uncommittedFiles: 2}}).map((c) => [c.detail, c.tooltipText])).toStrictEqual([
			["2 files", "2 uncommitted files on feat/x"],
		]);
	});

	it("doesn't offer to continue on the default branch, without changes, with Worktree on, or without both branches", () => {
		expect(
			[
				folder({git: {...DIRTY, headBranch: "main"}}),
				folder({git: {...DIRTY, uncommittedFiles: 0}}),
				folder({worktreeOn: true}),
				folder({git: {...DIRTY, defaultBranch: null}}),
				folder({git: {...DIRTY, headBranch: null}}),
				folder({used: new Set([nextStepKey(CONTINUE)])}),
			].map((candidates) => candidates.length),
		).toStrictEqual([0, 0, 0, 0, 0, 0]);
	});

	it("brings a dismissed continue row back once the uncommitted file count changes", () => {
		const dismissed = {[nextStepKey(CONTINUE)]: 1_000};
		expect(seats(folder(), dismissed)).toStrictEqual([]);
		expect(seats(folder({git: {...DIRTY, uncommittedFiles: 4}}), dismissed)).toStrictEqual([
			"/p\u0000feat/x\u00004",
		]);
	});

	it("never brings a dismissed Worktree row back for that folder", () => {
		const candidates = folder({git: {...DIRTY, uncommittedFiles: 0}, runningHere: true});
		expect(seats(candidates, {[nextStepKey(WORKTREE)]: 0})).toStrictEqual([]);
	});

	it("resumes a failed session, which returns after a new error", () => {
		const failed = {sessionId: "s9", title: "Fix bug", failedAt: 700};
		const resume: NextStepCandidate = {
			id: "resume-session",
			kind: "open",
			subject: "s9",
			stamp: 700,
			title: "Fix bug",
			detail: "Hit an error",
			tooltip: "Hit an error",
		};
		expect(folder({git: {...DIRTY, uncommittedFiles: 0}, failed})).toStrictEqual([resume]);
		expect(seats([resume], {[nextStepKey(resume)]: 700})).toStrictEqual([]);
		expect(seats([{...resume, stamp: 900}], {[nextStepKey(resume)]: 700})).toStrictEqual(["s9"]);
	});

	it("emits no folder rows while the draft is launching", () => {
		expect(
			folder({runningHere: true, failed: {sessionId: "s9", title: "Fix bug", failedAt: 700}, launching: true}),
		).toStrictEqual([]);
	});

	it("sorts resume-session after waiting sessions in the blocked family and folds it into the rest row", () => {
		const resume = folder({
			git: {...DIRTY, uncommittedFiles: 0},
			failed: {sessionId: "s9", title: "Fix bug", failedAt: 700},
		});
		expect(seats([...resume, ...blocked(1)])).toStrictEqual(["s1", "s9"]);
		expect(seats([...resume, ...blocked(3)])).toStrictEqual([
			"s1",
			"s2",
			{
				title: "Claude is blocked in 2 more sessions",
				dismissLabel: "Dismiss 2 blocked sessions",
				rest: ["s3", "s9"],
			},
		]);
	});
});

describe("sessionRunningIn", () => {
	const live = {project: "-p", state: "idle", archived: false} as const;

	it("counts a live, unarchived session in exactly the folder's project", () => {
		expect([
			sessionRunningIn([live], "-p"),
			sessionRunningIn([{...live, state: "working"}], "-p"),
			sessionRunningIn([{...live, state: "unknown"}], "-p"),
			sessionRunningIn([{...live, state: "ended"}], "-p"),
			sessionRunningIn([{...live, archived: true}], "-p"),
			sessionRunningIn([{...live, project: "-p-sub"}], "-p"),
			sessionRunningIn([live], undefined),
			sessionRunningIn([], "-p"),
		]).toStrictEqual([true, true, true, false, false, false, false, false]);
	});
});
