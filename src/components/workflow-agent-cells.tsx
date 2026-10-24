import type {CSSProperties} from "react";
import {
	cellCap,
	cellStates,
	progressSummary,
	pulseVars,
	type AgentState,
	type WorkflowProgressCounts,
} from "../lib/workflow-progress";

/** Upstream `M$`: each cell is a 6px square. */
const CELL_PX = 6;

type CellState = AgentState | "ghost";

/** Upstream `F$`: one agent cell; a running cell gets its own pulse timing. */
function AgentCell({state, cell, index = 0}: {state: CellState; cell: number | "ghost"; index?: number}) {
	const style: CSSProperties = {
		width: CELL_PX,
		height: CELL_PX,
		...(state === "running" ? pulseVars(index) : null),
	};
	return (
		<span
			data-cell={cell}
			className={`epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--${state}`}
			style={style}
		/>
	);
}

/**
 * Upstream `B$`: the wrapping agent-cell grid, one cell per agent (sampled
 * proportionally past the cap), ending with a ghost cell while more agents may
 * still be scheduled.
 */
export function WorkflowAgentCells({
	counts,
	maxRows,
	anticipate = false,
}: {
	counts: WorkflowProgressCounts;
	maxRows?: number;
	anticipate?: boolean;
}) {
	const states = cellStates(counts, cellCap({wrap: true, ...(maxRows === undefined ? null : {maxRows})}));
	return (
		<span
			role="img"
			aria-label={progressSummary(counts)}
			className="grid w-full overflow-hidden"
			style={{gridTemplateColumns: `repeat(auto-fill, ${CELL_PX}px)`, gap: 2, maxHeight: 62}}
		>
			{states.map((state, i) => (
				<AgentCell key={i} state={state} cell={i} index={i} />
			))}
			{anticipate && <AgentCell state="ghost" cell="ghost" />}
		</span>
	);
}
