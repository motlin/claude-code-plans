import
{
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
import type {PrEntry} from "../lib/pr-entries";
import type {GitPrState} from "../lib/pr-status";
import type {SessionStateKind} from "../lib/session-state";
import {TOUCH_QUERY} from "../lib/touch-reveal";
import {useMediaQuery} from "../lib/use-phone-sheet";
import {GIT_PR_STATE_LABELS} from "./git-pr-state-labels";
import {PrListCard} from "./sidebar/pr-list-card";
import {Pulse} from "./ui/pulse";
import {Tooltip} from "./ui/tooltip";
import {ROW_MARK_TOOLTIP_DELAY_MS} from "./ui/tooltip-classes";

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";

/** Upstream `Xs` PR glyphs, with the nearest lucide icon where upstream's has none (queued). */
const PR_GLYPH_ICONS =
{
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

const PR_GLYPH_STYLE =
{
	"--df-pr-glyph": "16px",
} as CSSProperties;

/**
 * Upstream's PR glyph (`tT place:"title"`): a git-coloured icon, counted when the row has two or more
 * PRs. With entries it opens the "Pull requests" card past the trailing slot; without, it keeps the
 * "Pull request · {state}" tooltip after 500ms, or (upstream `VA` on touch devices) no tooltip at all.
 */
export function PrTailGlyph({state, entries}: {state: GitPrState; entries: readonly PrEntry[]})
{
	const touch = useMediaQuery(TOUCH_QUERY);
	const Icon = PR_GLYPH_ICONS[state];
	const glyph = (
		<span aria-hidden="true" data-pr-glyph={state} className={PR_GLYPH_CLASS} style={PR_GLYPH_STYLE}>
			<Icon
				size={16}
				style={
				{
					color: `var(--color-git-${state})`,
				}}
			/>
			{entries.length > 1 && <span className="tabular-nums">{entries.length}</span>}
		</span>
	);
	if (entries.length === 0)
	{
		if (touch) return glyph;
		return (
			<Tooltip content={`Pull request · ${GIT_PR_STATE_LABELS[state]}`} delay={ROW_MARK_TOOLTIP_DELAY_MS}>
				{glyph}
			</Tooltip>
		);
	}
	return (
		<PrListCard entries={entries} pastTheSlot>
			{glyph}
		</PrListCard>
	);
}

const STATUS_PULSE_COLORS =
{
	awaiting: "var(--cds-fill-warning)",
	ready: "var(--cds-fill-accent)",
	running: "var(--cds-text-muted)",
} as const;

/**
 * Upstream's sidebar status Pulse (`QY` → `Io`): a static cds Pulse inside a `contents` wrapper
 * that turns its page-bg ring off. The wrapper keeps the local `.status-dot[data-kind]` hook.
 */
export function StatusPulse({kind}: {kind: keyof typeof STATUS_PULSE_COLORS})
{
	return (
		<span className="status-dot contents [--cds-page-bg:transparent]" data-kind={kind}>
			<Pulse
				animate={false}
				color={STATUS_PULSE_COLORS[kind]}
				{...(kind === "running"
					?
						{
							className: "df-tab-dot-running",
						}
					: {})}
			/>
		</span>
	);
}

/**
 * Upstream claude.ai/code session row icon: a 6px cds Pulse for awaiting and ready, a blinking
 * muted one while running, upstream's `U7`
 * 16px Warning triangle for an error (muted ink, as upstream's sO inside the code sidebar), and a
 * hollow ring for idle. A PR never takes this
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
})
{
	const describedByProps =
		describedBy === undefined
			? {}
			:
				{
					"aria-describedby": describedBy,
				};
	const ariaLabel = label ?? sessionStateKindLabels[kind];
	if (kind === "idle")
	{
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
				<TriangleAlert
					aria-hidden="true"
					size={16}
					className="shrink-0 text-[color:var(--muted-as-secondary,var(--cds-text-muted))]"
				/>
			) : (
				<StatusPulse kind={kind} />
			)}
		</span>
	);
}
