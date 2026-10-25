import {type CSSProperties, type PointerEvent, type ReactNode, useRef, useState} from "react";
import {
	type AgentCell as AgentCellData,
	cellCap,
	cellStates,
	progressSummary,
	pulseVars,
	type AgentState,
	type WorkflowProgressCounts,
} from "../lib/workflow-progress";
import {Tooltip} from "./ui/tooltip";

/** Upstream `M$`/`N$`/`yme`: each cell is a 6px square, 2px apart, so a row is 8px tall. */
const CELL_PX = 6;
const GAP_PX = 2;
const ROW_PX = 8;

/** Upstream `Cme`: wrapped rows shown by default. */
const DEFAULT_MAX_ROWS = 4;

/** Upstream `R$`: how far the pointer may stray off the hovered cell before the tip reverts to the summary. */
const HOVER_SLOP_PX = 3;

/** Upstream `L$`. */
const GHOST = "ghost";

type CellState = AgentState | typeof GHOST;

/** Upstream `P$`/`Tme`: the hovered cell's tooltip label. */
const CELL_LABEL: Record<CellState, string> = {
	done: "Done",
	running: "Running",
	stalled: "Stalled",
	error: "Failed",
	stopped: "Stopped",
	pending: "Queued",
	ghost: "More agents may appear",
};

/** Upstream `F$`: one agent cell; a running cell gets its own pulse timing. */
function AgentCell({state, cell, index = 0}: {state: CellState; cell: number | typeof GHOST; index?: number}) {
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
 * Upstream `z$`: the grid's `role=img` box, with a 150ms tooltip naming the hovered cell's state (and its
 * agent's label when every agent is known), or else the summary.
 */
function CellsTooltip({
	summary,
	cells,
	agents,
	hasGhost,
	className,
	tooltipClassName,
	style,
	children,
}: {
	summary: string;
	cells: readonly AgentState[];
	agents: readonly AgentCellData[] | undefined;
	hasGhost: boolean;
	className: string;
	tooltipClassName: string;
	style: CSSProperties;
	children: ReactNode;
}) {
	const [hovered, setHovered] = useState<number | typeof GHOST | null>(null);
	const hoveredRef = useRef<number | typeof GHOST | null>(null);
	const hoveredBox = useRef<DOMRect | null>(null);

	function move(event: PointerEvent<HTMLSpanElement>) {
		const target = event.target instanceof Element ? event.target.closest("[data-cell]") : null;
		if (target !== null) {
			const id = target.getAttribute("data-cell");
			const next = id === GHOST ? GHOST : Number(id);
			if (next !== hoveredRef.current) {
				hoveredRef.current = next;
				hoveredBox.current = target.getBoundingClientRect();
				setHovered(next);
			}
			return;
		}
		const box = hoveredBox.current;
		const inSlop =
			box !== null &&
			event.clientX >= box.left - HOVER_SLOP_PX &&
			event.clientX <= box.right + HOVER_SLOP_PX &&
			event.clientY >= box.top - HOVER_SLOP_PX &&
			event.clientY <= box.bottom + HOVER_SLOP_PX;
		if (!inSlop && hoveredRef.current !== null) {
			hoveredRef.current = null;
			hoveredBox.current = null;
			setHovered(null);
		}
	}

	function leave() {
		hoveredRef.current = -1;
		hoveredBox.current = null;
	}

	const state: CellState | undefined =
		hovered === GHOST ? (hasGhost ? GHOST : undefined) : hovered === null ? undefined : cells[hovered];
	const content = state === undefined ? summary : CELL_LABEL[state];
	const detail = typeof hovered === "number" ? agents?.[hovered]?.label : undefined;
	return (
		<Tooltip content={content} detail={detail} delay={150} closeOnClick={false} className={tooltipClassName}>
			<span
				role="img"
				aria-label={summary}
				className={className}
				style={style}
				onPointerMove={move}
				onPointerLeave={leave}
				onPointerCancel={leave}
			>
				{children}
			</span>
		</Tooltip>
	);
}

/**
 * Upstream `B$`: the agent-cell grid, one cell per agent (sampled proportionally past the cap), ending with a
 * ghost cell while more agents may still be scheduled. `wrap` flows the cells over up to `maxRows` rows, `cols`
 * fixes the column count (a phase row's grid), and neither keeps a single body-leading row.
 */
export function WorkflowAgentCells({
	counts,
	wrap = false,
	maxRows = DEFAULT_MAX_ROWS,
	cols,
	anticipate = false,
	agents,
}: {
	counts: WorkflowProgressCounts;
	wrap?: boolean;
	maxRows?: number;
	cols?: number | undefined;
	anticipate?: boolean;
	/** Every agent's label and state; used for the cells and tooltips when it covers every agent. */
	agents?: readonly AgentCellData[] | undefined;
}) {
	const cap = cellCap({wrap, maxRows, ...(cols === undefined ? null : {cols})});
	const perAgent = agents !== undefined && agents.length === counts.total && counts.total <= cap;
	const states = perAgent ? agents.map((agent) => agent.state) : cellStates(counts, cap);
	const labelled = perAgent ? agents : undefined;
	const summary = progressSummary(counts);
	const cells = states.map((state, i) => <AgentCell key={i} state={state} cell={i} index={i} />);
	const ghost = anticipate ? <AgentCell state={GHOST} cell={GHOST} /> : null;
	const tooltipProps = {summary, cells: states, agents: labelled, hasGhost: anticipate};

	// `flex` replaces the tooltip anchor's default `inline-flex`, keeping it block-level so no line box pads the grid's height.
	if (wrap || cols !== undefined) {
		const style: CSSProperties = cols
			? {gridTemplateColumns: `repeat(${cols}, ${CELL_PX}px)`, gap: GAP_PX}
			: {
					gridTemplateColumns: `repeat(auto-fill, ${CELL_PX}px)`,
					gap: GAP_PX,
					...(Number.isFinite(maxRows) ? {maxHeight: maxRows * ROW_PX - GAP_PX} : null),
				};
		return (
			<CellsTooltip
				{...tooltipProps}
				className={`grid ${cols ? "w-fit" : "w-full overflow-hidden"}`}
				tooltipClassName={cols ? "flex w-fit" : "flex w-full"}
				style={style}
			>
				{cells}
				{ghost}
			</CellsTooltip>
		);
	}
	return (
		<CellsTooltip
			{...tooltipProps}
			className="flex items-center"
			tooltipClassName="flex w-full"
			style={{height: "var(--text-body--line-height)"}}
		>
			<span
				className="grid w-full overflow-hidden"
				style={{gridTemplateColumns: `repeat(auto-fill, ${CELL_PX}px)`, gap: GAP_PX, maxHeight: CELL_PX}}
			>
				{cells}
				{ghost}
			</span>
		</CellsTooltip>
	);
}
