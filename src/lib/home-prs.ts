import type {PrChecks, PrStatus} from "./pr-status";
import type {PullRequestState} from "./session-state";

/** Upstream's PR states for the home pill map; review decisions fold into `open`. */
export type HomePrState = PullRequestState | "approved" | "changesRequested" | "conflicting" | "queued";

/** Upstream `dI` dot colors; each maps to a `--color-git-*` token in the section. */
export type HomePrTone = "green" | "yellow" | "orange" | "red" | "closed" | "neutral";

/** readyToMerge and needsAttention PRs float to the top of the section. */
export type HomePrCategory = "readyToMerge" | "needsAttention" | "other";

export interface HomePrPill {
	label: string;
	tone: HomePrTone;
	category: HomePrCategory;
}

/** Upstream bundle `mI`: a PR's pill label, tone and category, first match wins. */
export function prPill(state: HomePrState, checks: PrChecks | null): HomePrPill {
	const failed = (checks?.failed ?? 0) > 0;
	const pending = (checks?.pending ?? 0) > 0;
	if (state === "merged") return {label: "Merged", tone: "neutral", category: "other"};
	if (state === "closed") return {label: "Closed", tone: "closed", category: "other"};
	if (state === "draft") return {label: "Draft", tone: "neutral", category: "other"};
	if (state === "conflicting") {
		return {label: "Conflicting", tone: "orange", category: "needsAttention"};
	}
	if (state === "changesRequested") {
		return {label: "Changes requested", tone: "closed", category: "needsAttention"};
	}
	if (failed) return {label: "CI failing", tone: "red", category: "needsAttention"};
	if (state === "queued") return {label: "Queued", tone: "yellow", category: "other"};
	if (state === "approved") {
		return pending
			? {label: "Approved", tone: "green", category: "other"}
			: {label: "Ready to merge", tone: "green", category: "readyToMerge"};
	}
	if (checks !== null && pending) {
		const total = checks.passed + checks.failed + checks.pending;
		return {label: `CI ${total - checks.pending}/${total}`, tone: "neutral", category: "other"};
	}
	return {label: "Ready for review", tone: "neutral", category: "other"};
}

/** An open PR's review decision becomes upstream's approved / changesRequested state. */
export function homePrState(pr: Pick<PrStatus, "state" | "review">): HomePrState {
	if (pr.state !== "open") return pr.state;
	if (pr.review === "APPROVED") return "approved";
	if (pr.review === "CHANGES_REQUESTED") return "changesRequested";
	return "open";
}

export interface HomePrSource {
	sessionId: string;
	sessionTitle: string;
	lastActivityAt: number;
	pr: PrStatus | undefined;
}

export interface HomePrRow {
	sessionId: string;
	url: string;
	number: number;
	/** The PR title, else the session title. */
	title: string;
	/** `owner/repo` from the PR url, or null for a non-GitHub url. */
	repo: string | null;
	lastActivityAt: number;
	pill: HomePrPill;
}

function repoSlug(url: string): string | null {
	const match = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url);
	return match?.[1] ?? null;
}

const CATEGORY_RANK = {
	readyToMerge: 0,
	needsAttention: 0,
	other: 1,
} as const satisfies Record<HomePrCategory, number>;

/**
 * Upstream's Pull requests rows: active non-draft PRs deduped by url (newest session wins),
 * newest first with readyToMerge and needsAttention PRs floated to the top.
 */
export function selectHomePrs(sources: readonly HomePrSource[]): HomePrRow[] {
	const byUrl = new Map<string, HomePrRow>();
	const newestFirst = [...sources].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	for (const {sessionId, sessionTitle, lastActivityAt, pr} of newestFirst) {
		if (pr?.url === undefined || pr.state !== "open" || byUrl.has(pr.url)) continue;
		byUrl.set(pr.url, {
			sessionId,
			url: pr.url,
			number: pr.number,
			title: pr.title?.trim() || sessionTitle.trim() || "Untitled session",
			repo: repoSlug(pr.url),
			lastActivityAt,
			pill: prPill(homePrState(pr), pr.checks ?? null),
		});
	}
	return [...byUrl.values()].sort((a, b) => CATEGORY_RANK[a.pill.category] - CATEGORY_RANK[b.pill.category]);
}
