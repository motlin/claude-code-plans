/** Upstream's /code start-card "Next steps" candidate ids, in priority order. */
const NEXT_STEP_PRIORITY = [
	"waiting-session",
	"resume-session",
	"worktree-apart",
	"pr-ci-failed",
	"pr-review-comments",
	"suggested-task",
	"continue-branch",
	"connect-github",
	"cli-import",
	"auto-mode",
] as const;
export type NextStepId = (typeof NEXT_STEP_PRIORITY)[number];

/** Shown only when nothing else qualifies. */
const LOW_VALUE: ReadonlySet<NextStepId> = new Set(["connect-github", "cli-import", "auto-mode"]);

const FAMILY: Partial<Record<NextStepId, string>> = {
	"waiting-session": "blocked-sessions",
	"resume-session": "blocked-sessions",
	"suggested-task": "suggested-tasks",
};

/** Upstream's three visible seats. */
const SEATS = 3;

export interface NextStepCandidate {
	id: NextStepId;
	/** What the row is about, e.g. the session id. */
	subject: string;
	/** Activity time; a dismissed row returns once this moves past its dismissal. */
	stamp: number;
	title: string;
	detail: string | null;
}

export type NextStepRow<C extends NextStepCandidate> =
	| {type: "row"; candidate: C}
	| {type: "rest"; title: string; dismissLabel: string; rest: C[]};

/** The dismissal store key for a candidate's {row, subject}; its stamp is compared at read time. */
export function nextStepKey(candidate: Pick<NextStepCandidate, "id" | "subject">): string {
	return `next-step:${candidate.id}:${candidate.subject}`;
}

/** "Claude is blocked in 2 more sessions", or without "more" when the rest row stands for the whole family. */
export function blockedRestTitle(count: number, whole: boolean): string {
	return `Claude is blocked in ${count}${whole ? "" : " more"} ${count === 1 ? "session" : "sessions"}`;
}

export function blockedDismissLabel(count: number): string {
	return `Dismiss ${count} blocked ${count === 1 ? "session" : "sessions"}`;
}

/**
 * The start card's Next steps seats: live (undismissed) candidates by priority, grouped by family, the
 * first three groups seated one each and the leftover seats given to larger families in order. A family
 * with more members than seats shows seats-1 rows and a "rest" row that holds the others.
 */
export function selectNextSteps<C extends NextStepCandidate>({
	candidates,
	dismissed,
}: {
	candidates: readonly C[];
	dismissed: Readonly<Record<string, number>>;
}): NextStepRow<C>[] {
	const live = candidates.filter((c) => {
		const dismissedAt = dismissed[nextStepKey(c)];
		return dismissedAt === undefined || c.stamp > dismissedAt;
	});
	const valued = live.some((c) => !LOW_VALUE.has(c.id)) ? live.filter((c) => !LOW_VALUE.has(c.id)) : live;
	const ordered = valued.toSorted((a, b) => NEXT_STEP_PRIORITY.indexOf(a.id) - NEXT_STEP_PRIORITY.indexOf(b.id));

	const groups = new Map<string, C[]>();
	for (const c of ordered) {
		const key = FAMILY[c.id] ?? c.id;
		groups.set(key, [...(groups.get(key) ?? []), c]);
	}
	const seated = [...groups.values()].slice(0, SEATS).map((members) => ({members, seats: 1}));
	let leftover = SEATS - seated.length;
	for (const group of seated) {
		const extra = Math.min(leftover, group.members.length - 1);
		group.seats += extra;
		leftover -= extra;
	}

	return seated.flatMap(({members, seats}): NextStepRow<C>[] => {
		if (members.length <= seats) return members.map((candidate) => ({type: "row", candidate}));
		const shown = members.slice(0, seats - 1);
		const rest = members.slice(seats - 1);
		return [
			...shown.map((candidate): NextStepRow<C> => ({type: "row", candidate})),
			{
				type: "rest",
				title: blockedRestTitle(rest.length, shown.length === 0),
				dismissLabel: blockedDismissLabel(rest.length),
				rest,
			},
		];
	});
}

/** The PR fields a Next steps row needs, from the home Pull requests rows. */
export interface PrNextStepSource {
	sessionId: string;
	lastActivityAt: number;
	failedChecks: number;
}

function plural(count: number, one: string, other: string): string {
	return `${count} ${count === 1 ? one : other}`;
}

/** Upstream's `pr-review-comments` title. */
export function reviewCommentsTitle(count: number): string {
	return `Answer ${plural(count, "review comment", "review comments")}`;
}

/**
 * Upstream's `pr-ci-failed` rows: "Fix the failing checks" for each PR with a failing check, opening its
 * session. The PR cache counts checks without naming them, so the detail is the failing count.
 */
export function prNextStepCandidates(prs: readonly PrNextStepSource[]): NextStepCandidate[] {
	return prs
		.filter((pr) => pr.failedChecks > 0)
		.map((pr) => ({
			id: "pr-ci-failed",
			subject: pr.sessionId,
			stamp: pr.lastActivityAt,
			title: "Fix the failing checks",
			detail: plural(pr.failedChecks, "failing check", "failing checks"),
		}));
}
