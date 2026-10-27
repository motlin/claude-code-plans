import {
	GitMerge,
	GitMergeConflict,
	GitPullRequest,
	GitPullRequestArrow,
	GitPullRequestClosed,
	GitPullRequestDraft,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import {sessionStateKindLabels} from "../lib/schema-choices";
import type {GitPrState} from "../lib/pr-status";
import type {SessionStateKind} from "../lib/session-state";
import {Tooltip} from "./ui/tooltip";

export const GIT_PR_STATE_LABELS = {
	opened: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
	conflicting: "Merge conflicts",
	queued: "Queued",
} satisfies Record<GitPrState, string>;

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";

/** Upstream `Xs` PR glyphs, with the nearest lucide icon where upstream's has none (queued). */
const PR_GLYPH_ICONS = {
	opened: GitPullRequest,
	draft: GitPullRequestDraft,
	merged: GitMerge,
	closed: GitPullRequestClosed,
	conflicting: GitMergeConflict,
	queued: GitPullRequestArrow,
} satisfies Record<GitPrState, LucideIcon>;

const PR_GLYPH_CLASS = {
	title: "flex h-[var(--sb-row-ctl)] min-w-[var(--sb-row-ctl)] shrink-0 items-center justify-end gap-0.5 ps-[calc((var(--sb-row-ctl)-12px)/2)] pe-[calc((var(--sb-row-ctl)-12px)/2)] text-footnote text-ink-muted",
	line: "flex h-4 shrink-0 items-center gap-0.5",
} as const;

/**
 * Upstream's PR glyph (`tT`): a 12px git-coloured icon with a "Pull request · {state}" tooltip. The
 * `title` place is the row's title tail, just left of the trailing status slot; the `line` place
 * leads the branch on a described row's metadata line.
 */
export function PrTailGlyph({state, place = "title"}: {state: GitPrState; place?: keyof typeof PR_GLYPH_CLASS}) {
	const Icon = PR_GLYPH_ICONS[state];
	return (
		<Tooltip content={`Pull request · ${GIT_PR_STATE_LABELS[state]}`}>
			<span aria-hidden="true" data-pr-glyph={state} className={PR_GLYPH_CLASS[place]}>
				<Icon size={12} style={{color: `var(--color-git-${state})`}} />
			</span>
		</Tooltip>
	);
}

/**
 * Upstream claude.ai/code session row icon: a 6px `.status-dot` for live states, upstream's `U7`
 * 16px warning-coloured triangle for an error, and a hollow ring for idle. A PR never takes this
 * slot; it draws as a `PrTailGlyph`.
 */
export function SessionStateIcon({
	kind,
	label,
	live = true,
	"aria-describedby": describedBy,
}: {
	kind: SessionStateKind;
	label?: string;
	/** Upstream's `announce:false` mark is a plain `role=img`; a live one is a `role=status` region. */
	live?: boolean;
	/** Set by a wrapping Tooltip so the glyph is described by its tooltip. */
	"aria-describedby"?: string;
}) {
	const describedByProps = describedBy === undefined ? {} : {"aria-describedby": describedBy};
	const ariaLabel = label ?? sessionStateKindLabels[kind];
	if (kind === "idle") {
		return (
			<span role="img" aria-label={ariaLabel} className={DOT_WRAPPER} {...describedByProps}>
				<span
					aria-hidden="true"
					className="block size-[6px] rounded-full border border-current text-ink-muted opacity-50"
				/>
			</span>
		);
	}

	return (
		<span role={live ? "status" : "img"} aria-label={ariaLabel} className={DOT_WRAPPER} {...describedByProps}>
			{kind === "error" ? (
				<TriangleAlert aria-hidden="true" size={16} className="shrink-0 text-upstream-warning" />
			) : (
				<span className="status-dot" data-kind={kind} />
			)}
		</span>
	);
}
