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
import type {CSSProperties} from "react";
import {sessionStateKindLabels} from "../lib/schema-choices";
import type {GitPrState} from "../lib/pr-status";
import type {SessionStateKind} from "../lib/session-state";
import {GIT_PR_STATE_LABELS} from "./git-pr-state-labels";
import {Tooltip} from "./ui/tooltip";

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

/** Upstream `tT place:"title"`: the row's 16px title tail, just left of the trailing status slot. */
const PR_GLYPH_CLASS =
	"flex h-[var(--sb-row-ctl)] min-w-[var(--sb-row-ctl)] shrink-0 items-center justify-end gap-0.5 ps-[calc((var(--sb-row-ctl)-var(--df-pr-glyph))/2)] pe-[calc((var(--sb-row-ctl)-var(--df-pr-glyph))/2+max(0px,var(--df-heading-pitch,0px)-var(--sb-row-ctl)))] text-footnote text-muted-as-secondary";

const PR_GLYPH_STYLE = {"--df-pr-glyph": "16px"} as CSSProperties;

/** Upstream's PR glyph (`tT`): a git-coloured icon with a "Pull request · {state}" tooltip. */
export function PrTailGlyph({state}: {state: GitPrState}) {
	const Icon = PR_GLYPH_ICONS[state];
	return (
		<Tooltip content={`Pull request · ${GIT_PR_STATE_LABELS[state]}`}>
			<span aria-hidden="true" data-pr-glyph={state} className={PR_GLYPH_CLASS} style={PR_GLYPH_STYLE}>
				<Icon size={16} style={{color: `var(--color-git-${state})`}} />
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
