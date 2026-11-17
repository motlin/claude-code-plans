import type {PrStatus} from "./pr-status";
import type {SessionPrLink} from "./sessions";

/** Upstream's PR entry states (shared-18 `me`), most urgent first in `PR_ENTRY_ORDER`. */
export type PrEntryState =
	| "open"
	| "approved"
	| "changesRequested"
	| "conflicting"
	| "draft"
	| "queued"
	| "merged"
	| "closed";

export type PrCiState = "passed" | "pending" | "failed";

/** One row of upstream's "Pull requests" card (shared-18 `$i`); the diff stat has no local source. */
export interface PrEntry
{
	state: PrEntryState;
	repo?: string;
	number: number;
	url?: string;
	title?: string;
	ciState?: PrCiState;
}

/** Upstream's `HV`: the card lists conflicts first and closed PRs last. */
export const PR_ENTRY_ORDER =
{
	conflicting: 0,
	changesRequested: 1,
	open: 2,
	approved: 3,
	draft: 4,
	queued: 5,
	merged: 6,
	closed: 7,
} as const satisfies Record<PrEntryState, number>;

/** Upstream's `pB` state words at count 1. */
const STATE_WORDS =
{
	open: "Ready",
	approved: "Approved",
	changesRequested: "Changes requested",
	conflicting: "Conflict",
	draft: "Draft",
	queued: "Queued",
	merged: "Merged",
	closed: "Closed",
} as const satisfies Record<PrEntryState, string>;

const CI_WORDS =
{
	pending: "Checks running",
	failed: "Checks failed",
} as const;

/**
 * Upstream's `me`: an open PR takes its review decision. `conflicting` and `queued` need a mergeable
 * and merge-queue source that `PrStatus` doesn't have yet, so nothing local produces them.
 */
function entryState(pr: PrStatus): PrEntryState
{
	if (pr.state !== "open") return pr.state;
	if (pr.review === "CHANGES_REQUESTED") return "changesRequested";
	if (pr.review === "APPROVED") return "approved";
	return "open";
}

function ciState(checks: PrStatus["checks"]): PrCiState | undefined
{
	if (checks === undefined) return undefined;
	if (checks.failed > 0) return "failed";
	if (checks.pending > 0) return "pending";
	return "passed";
}

/** A session's PR card entries: local sessions hold at most one PR, so the list has 0 or 1 entries. */
export function prEntries(pr: PrStatus | undefined, link: SessionPrLink | undefined): PrEntry[]
{
	if (pr === undefined) return [];
	const entry: PrEntry =
	{
		state: entryState(pr),
		number: pr.number,
	};
	if (link !== undefined) entry.repo = link.repository;
	const url = pr.url ?? link?.url;
	// Upstream keeps only http(s) links, so a card entry never opens another scheme.
	if (url !== undefined && /^https?:\/\//i.test(url)) entry.url = url;
	if (pr.title !== undefined) entry.title = pr.title;
	const ci = ciState(pr.checks);
	if (ci !== undefined) entry.ciState = ci;
	// A single entry is already in PR_ENTRY_ORDER; upstream sorts its multi-PR list by it.
	return [entry];
}

/** Upstream's `CM`: an open PR reports running or failed checks, anything else its state word. */
export function prEntryStateLine(entry: PrEntry): string
{
	if (entry.state === "open" && (entry.ciState === "pending" || entry.ciState === "failed"))
		return CI_WORDS[entry.ciState];
	return STATE_WORDS[entry.state];
}
