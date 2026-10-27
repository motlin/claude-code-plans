import type {FolderGitStatus} from "./api/home-folder-status";

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
	/** The hover tooltip's detail line, when it says more than `detail`. */
	tooltip?: string;
	/** A text-only tooltip (no title line) in place of the title-over-detail one. */
	tooltipText?: string;
	/** The dismiss button's label, `Dismiss “{title}”` by default. */
	dismissLabel?: string;
	/** What a press does: open the subject's session (the default), turn on Worktree, or prefill the composer. */
	kind?: "open" | "worktree" | "prefill";
	/** A pressed Worktree row, shown as the static "Worktree is on" row. */
	taken?: true;
	/** The composer text a `prefill` press fills in. */
	prefill?: string;
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
	title: string;
	failedChecks: number;
	failingChecks: readonly string[];
	unresolvedReviewThreads: number;
	headBranch: string | null;
}

function plural(count: number, one: string, other: string): string {
	return `${count} ${count === 1 ? one : other}`;
}

/** Upstream's `pr-review-comments` title. */
export function reviewCommentsTitle(count: number): string {
	return `Answer ${plural(count, "review comment", "review comments")}`;
}

function ciFailedCandidate(pr: PrNextStepSource): NextStepCandidate {
	const candidate: NextStepCandidate = {
		id: "pr-ci-failed",
		subject: pr.sessionId,
		stamp: pr.lastActivityAt,
		title: "Fix the failing checks",
		detail: pr.failingChecks[0] ?? plural(pr.failedChecks, "failing check", "failing checks"),
	};
	const [check] = pr.failingChecks;
	if (check !== undefined && pr.headBranch !== null) candidate.tooltip = `${check} is failing on ${pr.headBranch}.`;
	return candidate;
}

/**
 * Upstream's PR rows, each opening the PR's session: "Fix the failing checks" for a PR with a failing
 * check, detailed by the first failing check's name (its count until the review details fetch names
 * it), and "Answer N review comments" for a PR with unresolved review threads, detailed by its title.
 */
export function prNextStepCandidates(prs: readonly PrNextStepSource[]): NextStepCandidate[] {
	return prs.flatMap((pr): NextStepCandidate[] => [
		...(pr.failedChecks > 0 || pr.failingChecks.length > 0 ? [ciFailedCandidate(pr)] : []),
		...(pr.unresolvedReviewThreads > 0
			? [
					{
						id: "pr-review-comments",
						subject: pr.sessionId,
						stamp: pr.lastActivityAt,
						title: reviewCommentsTitle(pr.unresolvedReviewThreads),
						detail: pr.title,
					} satisfies NextStepCandidate,
				]
			: []),
	]);
}

/**
 * Upstream's `runningHere`: a session runs in exactly the launch folder (its project, not a subfolder's).
 * Upstream reads a desktop `isRunning` flag; locally any live CLI counts, since two CLIs editing one
 * checkout is the hazard the Worktree row warns about.
 */
export function sessionRunningIn(
	sessions: readonly {project: string; state: string; archived: boolean}[],
	projectId: string | undefined,
): boolean {
	return (
		projectId !== undefined &&
		sessions.some((session) => session.project === projectId && session.state !== "ended" && !session.archived)
	);
}

/** The launch folder's state that upstream's folder-scoped rows (`qoe`) read. */
export interface FolderNextStepSource {
	folder: string | undefined;
	/** The folder's working tree, undefined until it loads. */
	git: FolderGitStatus | undefined;
	/** A live session is running in exactly this folder. */
	runningHere: boolean;
	worktreeOn: boolean;
	/** Worktree was turned on by pressing the row, for this draft and folder. */
	worktreeTaken: boolean;
	/** The keys of the `prefill` rows already pressed for this draft. */
	used: ReadonlySet<string>;
	/** The newest errored, unseen session in the folder. */
	failed: {sessionId: string; title: string; failedAt: number} | null;
	launching: boolean;
}

function worktreeCandidate({folder, git, runningHere, worktreeOn, worktreeTaken}: FolderNextStepSource) {
	if (folder === undefined || git?.isGitRepo !== true || !runningHere || (worktreeOn && !worktreeTaken)) return [];
	const candidate: NextStepCandidate = {
		id: "worktree-apart",
		kind: "worktree",
		// A zero stamp never passes its dismissal, so a dismissed row never returns for this folder.
		subject: folder,
		stamp: 0,
		title: "Turn on Worktree",
		detail: "Session running here",
		tooltipText:
			"Another session is running in this folder. Worktree gives this session its own copy, so their changes stay apart.",
		dismissLabel: "Dismiss the Worktree suggestion",
	};
	return [worktreeTaken ? {...candidate, taken: true as const} : candidate];
}

function continueCandidate({folder, git, worktreeOn, used}: FolderNextStepSource): NextStepCandidate[] {
	if (folder === undefined || git === undefined || worktreeOn) return [];
	const {headBranch: branch, defaultBranch, uncommittedFiles: files} = git;
	if (branch === null || defaultBranch === null || branch === defaultBranch || files === 0) return [];
	const candidate: NextStepCandidate = {
		id: "continue-branch",
		kind: "prefill",
		// The file count in the subject makes a changed count a new, undismissed row (upstream's stamp equality).
		subject: `${folder}\0${branch}\0${files}`,
		stamp: 0,
		title: "Continue uncommitted work",
		detail: plural(files, "file", "files"),
		tooltipText: `${plural(files, "uncommitted file", "uncommitted files")} on ${branch}`,
		dismissLabel: "Dismiss the uncommitted work",
		prefill: `Continue the work in progress on ${branch}: look at the uncommitted changes, tell me what state they\u2019re in, and finish what\u2019s started.`,
	};
	return used.has(nextStepKey(candidate)) ? [] : [candidate];
}

/**
 * Upstream's launch-folder rows: "Blocked {title} · Hit an error" for the folder's failed session,
 * "Turn on Worktree" when another session runs in the git folder, and "Continue uncommitted work" for a
 * non-default branch with uncommitted files. None while the draft is launching.
 */
export function folderNextStepCandidates(source: FolderNextStepSource): NextStepCandidate[] {
	if (source.launching) return [];
	const {failed} = source;
	return [
		...(failed === null
			? []
			: [
					{
						id: "resume-session",
						kind: "open",
						subject: failed.sessionId,
						stamp: failed.failedAt,
						title: failed.title,
						detail: "Hit an error",
						tooltip: "Hit an error",
					} satisfies NextStepCandidate,
				]),
		...worktreeCandidate(source),
		...continueCandidate(source),
	];
}
