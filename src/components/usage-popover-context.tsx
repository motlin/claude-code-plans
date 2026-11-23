import type {McpServerSummary} from "../lib/api/customize";
import {autoCompactHint, type CompactActionState} from "../lib/compact-action";
import
{
	type ComposerUsage,
	contextRingPercent,
	formatContextRingSummary,
	formatUpdatedAgo,
} from "../lib/composer-state";
import {type ContextBreakdown, contextRefreshHint} from "../lib/context-breakdown";
import {resolveStaleEngine} from "../lib/stale-engine";
import {CompactActionRow} from "./session-rail/compact-action-row";
import {ContextBreakdownCard, StaleEngineNotice} from "./session-rail/context-breakdown";
import {CONTEXT_BAR_TRACK_CLASS, usageFillClass} from "./session-rail/usage-fill";
import {Icon} from "./ui/icon";
import {Spinner} from "./ui/spinner";

/** What the session page knows that the ring popover's Context window section shows. */
export interface UsageRingContext
{
	/** The newest `/context` or mod breakdown, null when none or stale. */
	breakdown: ContextBreakdown | null;
	/** The CLI version running the session, for the stale-engine notice; null or absent when unknown. */
	engineVersion?: string | null | undefined;
	/** The breakdown query is loading. */
	breakdownFetching: boolean;
	/** A turn is running: the footer says the usage refreshes when it ends. */
	working: boolean;
	homeRoot: string;
	/** The connectors the session can manage. */
	mcpServers: readonly McpServerSummary[];
	/** The Compact session row: its availability and the `/compact` send. */
	compact?:
		|
		  {
				state: CompactActionState;
				onCompact: () => void;
		  }
		| undefined;
}

const LOADING_LABEL = "Loading context breakdown…";

/** Upstream c2d611398 `B`: the 4px window bar, toned by its rounded percent; no fill when the percent is unknown. */
function ContextBar({pct, summary}: {pct: number | null; summary: string})
{
	return (
		<div
			className={CONTEXT_BAR_TRACK_CLASS}
			style={
			{
				backgroundColor: "var(--chart-reference-tint)",
			}}
			role="progressbar"
			aria-label="Context window"
			aria-valuenow={pct ?? undefined}
			aria-valuetext={pct === null ? summary : undefined}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			{pct !== null && (
				<div
					className={`h-full ${usageFillClass(pct)} transition-[width]`}
					style={
					{
						width: `${pct}%`,
					}}
				/>
			)}
		</div>
	);
}

/**
 * Upstream c2d611398 `ne` with `layout: "popover"`: the ring popover's Context window section in context mode. A
 * toggle with the window summary expands the breakdown when there is one (or one is loading), then the compact
 * row, the stale footer and the loading row.
 */
export function UsagePopoverContextSection({
	usage,
	context,
	expanded,
	onToggle,
	onCompact,
}: {
	usage: ComposerUsage;
	context: UsageRingContext | undefined;
	expanded: boolean;
	onToggle: () => void;
	/** Closes the popover, then compacts (upstream's `Mt`). */
	onCompact: () => void;
})
{
	const resolved =
		context?.breakdown == null ? null : resolveStaleEngine(context.breakdown, context.engineVersion ?? null);
	const breakdown = resolved?.breakdown ?? null;
	const staleEngine = resolved?.staleEngine ?? null;
	const fetching = context?.breakdownFetching ?? false;
	const canExpand = breakdown !== null || fetching;
	const tokens = usage.contextTokens ?? 0;
	const summary = formatContextRingSummary(tokens, usage.contextWindowSize);
	const stale =
		breakdown !== null && usage.updatedAt !== null && Date.parse(breakdown.fetchedAt) < Date.parse(usage.updatedAt);
	const compact = context?.compact;
	return (
		<div data-usage-context-section="" className="flex flex-col">
			<button
				type="button"
				onClick={canExpand ? onToggle : undefined}
				aria-expanded={canExpand ? expanded : undefined}
				disabled={!canExpand}
				className="group flex items-center gap-2 px-lg py-xs min-h-[20px] text-start outline-none focus-visible:shadow-focus rounded"
			>
				<span className="text-footnote text-muted-as-secondary">Context window</span>
				<span className="text-footnote text-muted-as-secondary tabular-nums ms-auto">{summary}</span>
				{canExpand && (
					<Icon
						name="CaretRight"
						size="xs"
						rotate={expanded ? 90 : 0}
						className="text-muted-as-secondary group-hover:text-primary shrink-0 transition-transform duration-fast motion-reduce:transition-none"
					/>
				)}
			</button>
			<div className="mt-pad-xs px-lg pb-xs">
				{breakdown === null ? (
					<ContextBar pct={contextRingPercent(usage)} summary={summary} />
				) : (
					<ContextBreakdownCard
						breakdown={breakdown}
						liveTokens={usage.contextTokens}
						expanded={expanded}
						homeRoot={context?.homeRoot ?? ""}
						mcpServers={context?.mcpServers ?? []}
					/>
				)}
			</div>
			{compact !== undefined && compact.state.kind !== "hidden" && (
				<CompactActionRow
					inset="px-lg"
					state={compact.state}
					hint={autoCompactHint(breakdown?.autoCompactThreshold ?? null, usage.contextTokens)}
					onCompact={onCompact}
				/>
			)}
			{staleEngine !== null && <StaleEngineNotice staleEngine={staleEngine} inset="px-lg" />}
			{stale && (
				<div data-usage-context-updated="" className="mt-pad-xs px-lg pb-xs text-footnote text-secondary">
					Last updated{" "}
					<time dateTime={breakdown.fetchedAt}>{formatUpdatedAgo(breakdown.fetchedAt, Date.now())}</time>.{" "}
					{contextRefreshHint(context?.working ?? false, breakdown.source)}
				</div>
			)}
			{canExpand && expanded && breakdown === null && (
				<div
					data-usage-context-loading=""
					className="mt-pad-xs px-lg pb-xs flex min-h-6 items-center text-footnote text-secondary"
				>
					{fetching && (
						<div className="flex items-center gap-xs">
							<span className="flex min-w-3 shrink-0 items-center">
								<Spinner size="sm" delay={500} label={LOADING_LABEL} />
							</span>
							<span aria-hidden>{LOADING_LABEL}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
