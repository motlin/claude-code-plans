import type {GitPrState} from "../lib/pr-status";

export const GIT_PR_STATE_LABELS =
{
	opened: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
	conflicting: "Merge conflicts",
	queued: "Queued",
} satisfies Record<GitPrState, string>;
