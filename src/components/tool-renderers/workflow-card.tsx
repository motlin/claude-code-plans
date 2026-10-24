import {useEffect, useState} from "react";
import {ChevronRight} from "lucide-react";
import {formatPaddedElapsed} from "../../lib/working-marker";
import {
	buildWorkflowProgress,
	type WorkflowProgressCounts,
	type WorkflowProgressEntry,
} from "../../lib/workflow-progress";
import {ShimmerText} from "../shimmer-text";
import {WorkflowAgentCells} from "../workflow-agent-cells";

/** Upstream `Bme`: the counts of a run with no progress yet. */
const NO_AGENTS: WorkflowProgressCounts = {done: 0, running: 0, stalled: 0, error: 0, stopped: 0, pending: 0, total: 0};

/** Upstream `Vme`'s card cell grid: up to 8 wrapped rows. */
const CARD_MAX_ROWS = 8;

/** Upstream `K$` (`group/tool my-[6px]` plus the 318px task-card shell `dae`). */
const CARD_SHELL =
	"group/tool my-[6px] relative isolate flex self-start min-w-[318px] max-w-[318px] items-start gap-g5 rounded-r6 ps-3 py-2.5 text-start text-pretty";

/** Re-renders every second while mounted, like upstream's ticking `now` (`W$(!0)`). */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => {
			clearInterval(timer);
		};
	}, []);
	return now;
}

/** Upstream `V$`: "N agent(s)" with the number in secondary ink. */
function AgentCount({total}: {total: number}) {
	return (
		<span className="whitespace-nowrap">
			<span className="text-secondary">{total}</span> {total === 1 ? "agent" : "agents"}
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
}) {
	const now = useNow();
	const model = buildWorkflowProgress(progress, {now, settled: false});
	const counts = model?.counts ?? NO_AGENTS;
	const hasName = name !== "";
	const label = preLaunch ? "Starting workflow" : "Workflow";
	const content = (
		<span className="flex min-w-0 flex-1 flex-col gap-1">
			{hasName && <ShimmerText className="min-w-0 truncate text-body text-primary">{name}</ShimmerText>}
			<span
				className={`flex min-w-0 items-center gap-2 text-footnote text-ink-muted tabular-nums${hasName ? "" : " pb-0.75"}`}
				style={{minHeight: "var(--text-body--line-height)"}}
			>
				{hasName ? (
					<span className="shrink-0 text-secondary">{label}</span>
				) : (
					<ShimmerText className="shrink-0 text-secondary">{label}</ShimmerText>
				)}
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
			{/* Upstream `pt-sm`: 5px, which the measured 318x81 one-row card pins. */}
			<span className="block pt-p4 pb-0.5">
				<WorkflowAgentCells counts={counts} maxRows={CARD_MAX_ROWS} anticipate />
			</span>
		</span>
	);
	const surface = (
		<span
			aria-hidden="true"
			className="card-outline absolute inset-0 -z-[1] rounded-[inherit] group-hover/btn:bg-fill-ghost-hover"
		/>
	);
	if (onOpen === undefined) {
		return (
			<div className={`${CARD_SHELL} pe-4`}>
				{surface}
				{content}
			</div>
		);
	}
	return (
		<button
			type="button"
			onClick={onOpen}
			data-transcript-keeps-pin=""
			aria-label={hasName ? `View workflow: ${name}` : "View workflow"}
			className={`${CARD_SHELL} group/btn outline-none hide-focus-ring focus-visible:ring-focus pe-2`}
		>
			{surface}
			{content}
			<span
				className="flex shrink-0 items-center self-start text-ink-muted"
				style={{height: "var(--text-body--line-height)"}}
			>
				<ChevronRight size={16} aria-hidden="true" />
			</span>
		</button>
	);
}
