import {useNow} from "../../hooks/use-now";
import {ChevronRight} from "lucide-react";
import {formatPaddedElapsed} from "../../lib/elapsed-format";
import
{
	agentCells,
	buildWorkflowProgress,
	type WorkflowProgressCounts,
	type WorkflowProgressEntry,
} from "../../lib/workflow-progress";
import {ShimmerText} from "../shimmer-text";
import {WorkflowAgentCells} from "../workflow-agent-cells";

/** Upstream `Bme`: the counts of a run with no progress yet. */
const NO_AGENTS: WorkflowProgressCounts =
{
	done: 0,
	running: 0,
	stalled: 0,
	error: 0,
	stopped: 0,
	pending: 0,
	total: 0,
};

/** Upstream `Vme`'s card cell grid: up to 8 wrapped rows. */
const CARD_MAX_ROWS = 8;

/**
 * Upstream's xs cds Card root: a CardLink inside paints the fill-card after-layer, fill-card-hover on hover and
 * neutral-hover while pressed (its card ring is a zero-width flat edge, so none is drawn).
 */
const CARD_CLASS =
	"group/card relative isolate flex flex-col rounded-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus has-[[data-cds=CardLink]:active]:after:bg-neutral-hover has-[[data-cds=CardLink]]:after:bg-fill-card has-[[data-cds=CardLink]]:not-has-[[data-cds=CardLink]:active]:hover:after:bg-fill-card-hover my-[var(--chat-card-bump,6px)] self-start min-w-[318px] max-w-[318px] text-start text-pretty";

const CARD_FILL_CLASS = "cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit]";

/** Upstream `p-lg`: 12px under upstream's xs scale, which the local compact xs scale shrinks to 10px. */
const CARD_BODY_CLASS = "cds-card-body flex min-h-0 flex-1 flex-col self-stretch rounded-[inherit] p-p8";

const CARD_LINK_CLASS =
	"outline-none after:absolute after:inset-0 after:rounded-card after:contain-paint after:content-[''] cursor-pointer";

/** Upstream `V$`: "N agent(s)" with the number in secondary ink, unless muted. */
export function AgentCount({total, muted = false}: {total: number; muted?: boolean})
{
	return (
		<span className="whitespace-nowrap">
			{muted ? total : <span className="text-secondary">{total}</span>} {total === 1 ? "agent" : "agents"}
		</span>
	);
}

/**
 * Upstream `Vme`: the compact transcript card of a starting or running
 * workflow -- its name, "Starting workflow" or "Workflow" with the agent count
 * and elapsed time, and the agent-cell grid. It opens the Background tasks
 * pane when one can host it, else it is a plain, chevronless card.
 */
export function WorkflowCard({
	name,
	preLaunch = false,
	startedAt,
	progress,
	onOpen,
}: {
	name: string;
	preLaunch?: boolean;
	/** Epoch ms. */
	startedAt?: number | undefined;
	progress: readonly WorkflowProgressEntry[];
	onOpen?: (() => void) | undefined;
})
{
	const now = useNow();
	const model = buildWorkflowProgress(
		progress,
		{
			now,
			settled: false,
		},
	);
	const counts = model?.counts ?? NO_AGENTS;
	const agents = model
		? agentCells(
				model.phases.flatMap((phase) => phase.agents),
				{
					now,
				},
			)
		: undefined;
	const hasName = name !== "";
	const label = preLaunch ? "Starting workflow" : "Workflow";
	const content = (
		<span className="flex min-w-0 flex-1 flex-col gap-1">
			{hasName && (
				<span className="flex min-w-0 items-baseline gap-xs">
					<ShimmerText className="min-w-0 truncate text-body text-primary">{name}</ShimmerText>
				</span>
			)}
			<span
				className={`flex min-w-0 items-center gap-2 text-footnote text-ink-muted tabular-nums${hasName ? "" : " pb-0.75"}`}
				style={
				{
					minHeight: "var(--text-body--line-height)",
				}}
			>
				<ShimmerText active={!hasName} className="shrink-0 text-secondary">
					{label}
				</ShimmerText>
				{counts.total > 0 && (
					<span className="shrink-0">
						<AgentCount total={counts.total} />
					</span>
				)}
				{startedAt !== undefined && (
					<span className="shrink-0">
						<span className="tabular-nums">
							{formatPaddedElapsed(Math.max(0, Math.round((now - startedAt) / 1000)))}
						</span>
					</span>
				)}
			</span>
			{/* Upstream `pt-sm`: 6px under upstream's xs scale (the local compact xs scale makes it 4px). */}
			<span className="relative z-1 block pt-p5 pb-0.5">
				<WorkflowAgentCells counts={counts} wrap maxRows={CARD_MAX_ROWS} anticipate agents={agents} />
			</span>
		</span>
	);
	const row = (
		<span className="flex min-w-0 items-center gap-xs">
			{content}
			{onOpen !== undefined && (
				<span
					className="flex shrink-0 items-center self-start text-ink-muted"
					style={
					{
						height: "var(--text-body--line-height)",
					}}
				>
					<ChevronRight size={16} aria-hidden="true" />
				</span>
			)}
		</span>
	);
	return (
		<div data-cds="Card" data-size="xs" className={CARD_CLASS}>
			<span aria-hidden="true" className={CARD_FILL_CLASS} />
			<div data-cds-card-body="" className={CARD_BODY_CLASS}>
				{onOpen === undefined ? (
					row
				) : (
					<span
						data-cds="CardLink"
						role="button"
						tabIndex={0}
						data-transcript-keeps-pin=""
						aria-label={hasName ? `View workflow: ${name}` : "View workflow"}
						onClick={onOpen}
						onKeyDown={(event) =>
						{
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							onOpen();
						}}
						className={CARD_LINK_CLASS}
					>
						{row}
					</span>
				)}
			</div>
		</div>
	);
}
