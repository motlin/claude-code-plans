import {useMemo, useState} from "react";
import {Activity} from "lucide-react";
import type {WorkflowRunInfo} from "../lib/subagent-tree";
import type {Subagent} from "../lib/subagents";
import {formatDuration} from "../lib/format-duration";
import {formatModelName} from "../lib/model-name";
import {layoutSwimlanes, type SwimlaneLayout} from "./subagent-gantt-layout";

const AGENT_BAR_COLORS: Record<string, string> = {
	Explore: "#3b82f6",
	Plan: "#a855f7",
	"build:precommit-runner": "#eab308",
	"git:commit-handler": "#22c55e",
	"git:rebaser": "#ec4899",
	"markdown-tasks:do-task": "#f97316",
	"general-purpose": "#6b7280",
};

function getBarColor(agentType: string | null): string {
	if (!agentType) return "#6b7280";
	return AGENT_BAR_COLORS[agentType] ?? "#6b7280";
}

function getShortType(agentType: string | null): string {
	if (!agentType) return "agent";
	return agentType.split(":").at(-1) ?? agentType;
}

// Wide enough for the indented type, the description, and the model name the
// lane ends with, which is right-aligned so the models read as their own column.
const LABEL_COL_W = 270;
const LANE_HEIGHT = 28;
const LANE_GAP = 6;
const HEADER_HEIGHT = 24;
const PADDING_X = 12;
const PADDING_Y = 12;
const MIN_BAR_WIDTH = 2;

const ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;
type ZoomLevel = (typeof ZOOM_LEVELS)[number];

function timeAt(offsetMs: number, totalMs: number, plotWidth: number): number {
	if (totalMs === 0) return 0;
	return (offsetMs / totalMs) * plotWidth;
}

interface GanttHeaderRow {
	key: string;
	row: number;
	label: string;
	kind: "run" | "phase";
}

/** Places each lane on a row, inserting a run header row and a phase sub-header row before each workflow group. */
function layoutRows(layout: SwimlaneLayout): {
	laneRows: number[];
	laneIndents: number[];
	headers: GanttHeaderRow[];
	rowCount: number;
} {
	const groupAt = new Map(layout.groups.map((group) => [group.firstLane, group]));
	const laneRows: number[] = [];
	const laneIndents: number[] = [];
	const headers: GanttHeaderRow[] = [];
	let row = 0;
	let previousRunId: string | null = null;
	let groupEnd = 0;
	for (let lane = 0; lane < layout.lanes.length; lane++) {
		const group = groupAt.get(lane);
		if (group !== undefined) {
			if (group.runId !== previousRunId) {
				headers.push({key: `run-${group.runId}`, row: row++, label: group.name, kind: "run"});
				previousRunId = group.runId;
			}
			headers.push({key: `phase-${group.runId}-${lane}`, row: row++, label: group.phaseTitle, kind: "phase"});
			groupEnd = lane + group.laneCount;
		}
		laneIndents.push(lane < groupEnd ? 2 : 0);
		laneRows.push(row++);
	}
	return {laneRows, laneIndents, headers, rowCount: row};
}

export function SubagentGantt({
	agents,
	workflowRuns,
}: {
	agents: Subagent[];
	workflowRuns?: readonly WorkflowRunInfo[] | undefined;
}) {
	const layout = useMemo(() => layoutSwimlanes(agents, {workflowRuns}), [agents, workflowRuns]);
	const rows = useMemo(() => layoutRows(layout), [layout]);
	const [zoom, setZoom] = useState<ZoomLevel>(1);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	if (layout.lanes.length === 0) {
		return null;
	}

	const basePlotWidth = 720;
	const plotWidth = basePlotWidth * zoom;
	const totalWidth = LABEL_COL_W + plotWidth + PADDING_X * 2;
	const totalHeight = HEADER_HEIGHT + rows.rowCount * (LANE_HEIGHT + LANE_GAP) + PADDING_Y * 2;

	return (
		<div className="mt-3">
			<div className="flex items-center justify-between mb-1">
				<h2 className="text-xs font-semibold text-t6 uppercase tracking-wide flex items-center gap-2">
					<Activity size={12} />
					Subagent timeline
				</h2>
				<div className="flex items-center gap-1 text-[10px] text-t6" role="group" aria-label="Zoom level">
					<span>Zoom</span>
					{ZOOM_LEVELS.map((z) => (
						<button
							key={z}
							type="button"
							onClick={() => {
								setZoom(z);
							}}
							aria-pressed={zoom === z}
							className={`rounded px-1.5 py-0.5 tabular-nums ${
								zoom === z ? "bg-accent-000/15 text-accent-100" : "hover:bg-surface-0/50 text-t6"
							}`}
						>
							{z}x
						</button>
					))}
				</div>
			</div>
			<div className="overflow-auto rounded-md border border-strong bg-surface-1/40">
				<svg
					width={totalWidth}
					height={totalHeight}
					className="block"
					role="img"
					aria-label="Subagent Gantt chart"
				>
					<defs>
						<pattern
							id="gantt-waiting-pattern"
							patternUnits="userSpaceOnUse"
							width="6"
							height="6"
							patternTransform="rotate(45)"
						>
							<line
								x1="0"
								y1="0"
								x2="0"
								y2="6"
								stroke="currentColor"
								strokeWidth="2"
								className="text-t6/40"
							/>
						</pattern>
					</defs>

					<g transform={`translate(${LABEL_COL_W + PADDING_X}, ${PADDING_Y})`} className="text-t6">
						{layout.ticks.map((tick, i) => {
							const x = timeAt(tick.offsetMs, layout.totalMs, plotWidth);
							return (
								<g key={i}>
									<line
										x1={x}
										y1={HEADER_HEIGHT - 4}
										x2={x}
										y2={HEADER_HEIGHT + rows.rowCount * (LANE_HEIGHT + LANE_GAP)}
										stroke="currentColor"
										strokeOpacity={0.1}
										strokeWidth={1}
									/>
									<text
										x={x}
										y={HEADER_HEIGHT - 8}
										fontSize={10}
										textAnchor={
											i === 0 ? "start" : i === layout.ticks.length - 1 ? "end" : "middle"
										}
										fill="currentColor"
									>
										{tick.label}
									</text>
								</g>
							);
						})}
					</g>

					<g transform={`translate(0, ${PADDING_Y + HEADER_HEIGHT})`}>
						{rows.headers.map((header) => (
							<text
								key={header.key}
								x={PADDING_X + (header.kind === "phase" ? 10 : 0)}
								y={header.row * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT / 2 + 4}
								fontSize={header.kind === "run" ? 11 : 10}
								fontWeight={header.kind === "run" ? 600 : undefined}
								fill="currentColor"
								className={header.kind === "run" ? "text-primary" : "text-t6"}
							>
								{header.label}
							</text>
						))}
						{layout.lanes.map((lane, i) => {
							const y = (rows.laneRows[i] ?? i) * (LANE_HEIGHT + LANE_GAP);
							const indent = lane.depth + (rows.laneIndents[i] ?? 0);
							const xStart = timeAt(lane.startMs - layout.startMs, layout.totalMs, plotWidth);
							const widthRaw = timeAt(lane.endMs - lane.startMs, layout.totalMs, plotWidth);
							const width = Math.max(widthRaw, MIN_BAR_WIDTH);
							const color = getBarColor(lane.agent.agentType);
							const modelLabel = formatModelName(lane.agent.model);
							const dimmed = hoveredId !== null && hoveredId !== lane.agent.id;
							return (
								<g
									key={lane.agent.id}
									onMouseEnter={() => {
										setHoveredId(lane.agent.id);
									}}
									onMouseLeave={() => {
										setHoveredId(null);
									}}
									style={{
										opacity: dimmed ? 0.35 : 1,
										transition: "opacity 0.15s",
									}}
								>
									<text
										x={PADDING_X + indent * 10}
										y={y + LANE_HEIGHT / 2 + 4}
										fontSize={11}
										fill="currentColor"
										className="text-primary"
									>
										{truncate(getShortType(lane.agent.agentType), 12)}
									</text>
									<text
										x={PADDING_X + indent * 10 + 70}
										y={y + LANE_HEIGHT / 2 + 4}
										fontSize={10}
										fill="currentColor"
										className="text-t6"
									>
										{truncate(lane.agent.description ?? lane.agent.slug ?? "", 14)}
									</text>
									{modelLabel && (
										<text
											x={LABEL_COL_W - 8}
											y={y + LANE_HEIGHT / 2 + 4}
											fontSize={10}
											textAnchor="end"
											fill="currentColor"
											className="text-t6"
										>
											{truncate(modelLabel, 12)}
										</text>
									)}

									<rect
										x={LABEL_COL_W + PADDING_X}
										y={y}
										width={plotWidth}
										height={LANE_HEIGHT}
										fill="currentColor"
										fillOpacity={0.03}
										className="text-t6"
									/>

									<g transform={`translate(${LABEL_COL_W + PADDING_X}, 0)`}>
										<rect
											x={xStart}
											y={y + 4}
											width={width}
											height={LANE_HEIGHT - 8}
											rx={3}
											fill={color}
											fillOpacity={0.85}
										>
											<title>
												{`${getShortType(lane.agent.agentType)} · ${formatDuration(lane.endMs - lane.startMs)}`}
											</title>
										</rect>
										{lane.waiting.map((range, j) => {
											const wxStart = timeAt(
												range.startMs - layout.startMs,
												layout.totalMs,
												plotWidth,
											);
											const wxEnd = timeAt(
												range.endMs - layout.startMs,
												layout.totalMs,
												plotWidth,
											);
											const wWidth = Math.max(wxEnd - wxStart, MIN_BAR_WIDTH);
											return (
												<rect
													key={j}
													x={wxStart}
													y={y + 4}
													width={wWidth}
													height={LANE_HEIGHT - 8}
													rx={3}
													fill="url(#gantt-waiting-pattern)"
												>
													<title>{`waiting ${formatDuration(range.endMs - range.startMs)}`}</title>
												</rect>
											);
										})}
									</g>
								</g>
							);
						})}
					</g>
				</svg>
			</div>
			<div className="mt-2 flex items-center gap-3 text-[10px] text-t6">
				<span className="flex items-center gap-1">
					<span className="inline-block w-3 h-3 rounded-sm" style={{background: "#6b7280", opacity: 0.85}} />
					active
				</span>
				<span className="flex items-center gap-1">
					<span
						className="inline-block w-3 h-3 rounded-sm border border-t6/30"
						style={{
							backgroundImage:
								"repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)",
							color: "rgb(107 114 128 / 0.6)",
						}}
					/>
					waiting on child
				</span>
			</div>
		</div>
	);
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "\u2026";
}
