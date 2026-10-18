import {describe, expect, it} from "vite-plus/test";

import {
	blockedDismissLabel,
	blockedRestTitle,
	nextStepKey,
	prNextStepCandidates,
	reviewCommentsTitle,
	selectNextSteps,
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
	function pr(sessionId: string, failedChecks: number) {
		return {sessionId, lastActivityAt: 500, failedChecks};
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

	it("titles review comments in the singular and plural", () => {
		expect([1, 4].map(reviewCommentsTitle)).toStrictEqual(["Answer 1 review comment", "Answer 4 review comments"]);
	});
});
