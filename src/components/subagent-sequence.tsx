import {useMemo, useState} from "react";
import {Workflow} from "lucide-react";
import type {WorkflowRunInfo} from "../lib/subagent-tree";
import type {Subagent} from "../lib/subagents";
import {formatDuration} from "../lib/format-duration";
import {layoutSequence, type SequenceLayout} from "./subagent-sequence-layout";

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

const COLUMN_WIDTH = 96;
const HEADER_HEIGHT = 56;
const TIME_AXIS_WIDTH = 56;
const PADDING_X = 12;
const PADDING_Y = 12;
const BAR_WIDTH = 12;
/** Height of the run / phase label band above the lifeline headers, when the session has workflow runs. */
const GROUP_BAND_HEIGHT = 36;
const MIN_BAR_HEIGHT = 2;

const ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;
type ZoomLevel = (typeof ZOOM_LEVELS)[number];

function timeAt(offsetMs: number, totalMs: number, plotHeight: number): number {
	if (totalMs === 0) return 0;
	return (offsetMs / totalMs) * plotHeight;
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "\u2026";
}

interface RunSpan {
	runId: string;
	name: string;
	firstColumn: number;
	columnCount: number;
}

/** Each run's column range: its phases are adjacent, so it spans from its first phase to its last. */
function runSpans(layout: SequenceLayout): RunSpan[] {
	const spans: RunSpan[] = [];
	for (const group of layout.groups) {
		const last = spans.at(-1);
		if (last?.runId === group.runId) {
			last.columnCount = group.firstColumn + group.columnCount - last.firstColumn;
		} else {
			spans.push({
				runId: group.runId,
				name: group.name,
				firstColumn: group.firstColumn,
				columnCount: group.columnCount,
			});
		}
	}
	return spans;
}

export function SubagentSequence({
	agents,
	workflowRuns,
}: {
	agents: Subagent[];
	workflowRuns?: readonly WorkflowRunInfo[] | undefined;
}) {
	const layout = useMemo(() => layoutSequence(agents, {workflowRuns}), [agents, workflowRuns]);
	const runs = useMemo(() => runSpans(layout), [layout]);
	const [zoom, setZoom] = useState<ZoomLevel>(1);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	if (layout.lifelines.length === 0) {
		return null;
	}

	const basePlotHeight = 360;
	const plotHeight = basePlotHeight * zoom;
	const totalWidth = TIME_AXIS_WIDTH + layout.lifelines.length * COLUMN_WIDTH + PADDING_X * 2;
	const bandHeight = layout.groups.length === 0 ? 0 : GROUP_BAND_HEIGHT;
	const totalHeight = bandHeight + HEADER_HEIGHT + plotHeight + PADDING_Y * 2;

	const columnX = (column: number) => TIME_AXIS_WIDTH + PADDING_X + column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
	const spanCenter = (firstColumn: number, columnCount: number) =>
		TIME_AXIS_WIDTH + PADDING_X + (firstColumn + columnCount / 2) * COLUMN_WIDTH;

	return (
		<div className="mt-3">
			<div className="flex items-center justify-between mb-1">
				<h2 className="text-xs font-semibold text-t6 uppercase tracking-wide flex items-center gap-2">
					<Workflow size={12} />
					Subagent sequence
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
					aria-label="Subagent sequence diagram"
				>
					<defs>
						<pattern
							id="sequence-waiting-pattern"
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
						<marker
							id="sequence-arrow-solid"
							viewBox="0 0 10 10"
							refX="8"
							refY="5"
							markerWidth="6"
							markerHeight="6"
							orient="auto-start-reverse"
						>
							<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
						</marker>
						<marker
							id="sequence-arrow-dashed"
							viewBox="0 0 10 10"
							refX="8"
							refY="5"
							markerWidth="6"
							markerHeight="6"
							orient="auto-start-reverse"
						>
							<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
						</marker>
					</defs>

					{bandHeight > 0 && (
						<g transform={`translate(0, ${PADDING_Y})`} className="text-t6">
							{runs.map((run) => (
								<g key={`run-${run.runId}`}>
									<text
										x={spanCenter(run.firstColumn, run.columnCount)}
										y={11}
										fontSize={11}
										fontWeight={600}
										textAnchor="middle"
										fill="currentColor"
										className="text-primary"
									>
										{run.name}
									</text>
									<line
										x1={TIME_AXIS_WIDTH + PADDING_X + run.firstColumn * COLUMN_WIDTH + 6}
										y1={16}
										x2={
											TIME_AXIS_WIDTH +
											PADDING_X +
											(run.firstColumn + run.columnCount) * COLUMN_WIDTH -
											6
										}
										y2={16}
										stroke="currentColor"
										strokeOpacity={0.4}
									/>
								</g>
							))}
							{layout.groups.map((group) => (
								<text
									key={`phase-${group.runId}-${group.firstColumn}`}
									x={spanCenter(group.firstColumn, group.columnCount)}
									y={30}
									fontSize={10}
									textAnchor="middle"
									fill="currentColor"
								>
									{group.phaseTitle}
								</text>
							))}
						</g>
					)}

					<g transform={`translate(0, ${PADDING_Y + bandHeight})`} className="text-t6">
						{layout.lifelines.map((lane) => {
							const x = columnX(lane.column);
							const dimmed = hoveredId !== null && hoveredId !== lane.agent.id;
							return (
								<g
									key={`header-${lane.agent.id}`}
									style={{
										opacity: dimmed ? 0.35 : 1,
										transition: "opacity 0.15s",
									}}
									onMouseEnter={() => {
										setHoveredId(lane.agent.id);
									}}
									onMouseLeave={() => {
										setHoveredId(null);
									}}
								>
									<rect
										x={x - COLUMN_WIDTH / 2 + 6}
										y={4}
										width={COLUMN_WIDTH - 12}
										height={HEADER_HEIGHT - 12}
										rx={4}
										fill={getBarColor(lane.agent.agentType)}
										fillOpacity={0.12}
										stroke={getBarColor(lane.agent.agentType)}
										strokeOpacity={0.4}
									/>
									<text
										x={x}
										y={20}
										fontSize={11}
										textAnchor="middle"
										fill="currentColor"
										className="text-primary"
									>
										{truncate(getShortType(lane.agent.agentType), 12)}
									</text>
									<text
										x={x}
										y={34}
										fontSize={9}
										textAnchor="middle"
										fill="currentColor"
										className="text-t6"
									>
										{truncate(lane.agent.description ?? lane.agent.slug ?? "", 14)}
									</text>
									<g transform={`translate(${x - 14}, ${HEADER_HEIGHT - 18})`}>
										<rect
											x={0}
											y={0}
											width={28}
											height={12}
											rx={6}
											fill="currentColor"
											fillOpacity={0.08}
										/>
										<text
											x={14}
											y={9}
											fontSize={9}
											textAnchor="middle"
											fill="currentColor"
											className="text-t6"
										>
											{`d${lane.depth}`}
										</text>
									</g>
								</g>
							);
						})}
					</g>

					<g transform={`translate(0, ${PADDING_Y + bandHeight + HEADER_HEIGHT})`} className="text-t6">
						{layout.ticks.map((tick, i) => {
							const y = timeAt(tick.offsetMs, layout.totalMs, plotHeight);
							return (
								<g key={i}>
									<line
										x1={TIME_AXIS_WIDTH - 4}
										y1={y}
										x2={TIME_AXIS_WIDTH + PADDING_X + layout.lifelines.length * COLUMN_WIDTH}
										y2={y}
										stroke="currentColor"
										strokeOpacity={0.08}
										strokeWidth={1}
									/>
									<text
										x={TIME_AXIS_WIDTH - 8}
										y={y + 3}
										fontSize={10}
										textAnchor="end"
										fill="currentColor"
									>
										{tick.label}
									</text>
								</g>
							);
						})}

						{layout.lifelines.map((lane) => {
							const x = columnX(lane.column);
							const yStart = timeAt(lane.startMs - layout.startMs, layout.totalMs, plotHeight);
							const yEnd = timeAt(lane.endMs - layout.startMs, layout.totalMs, plotHeight);
							const heightRaw = yEnd - yStart;
							const height = Math.max(heightRaw, MIN_BAR_HEIGHT);
							const color = getBarColor(lane.agent.agentType);
							const dimmed = hoveredId !== null && hoveredId !== lane.agent.id;
							return (
								<g
									key={`lifeline-${lane.agent.id}`}
									style={{
										opacity: dimmed ? 0.35 : 1,
										transition: "opacity 0.15s",
									}}
									onMouseEnter={() => {
										setHoveredId(lane.agent.id);
									}}
									onMouseLeave={() => {
										setHoveredId(null);
									}}
								>
									<line
										x1={x}
										y1={0}
										x2={x}
										y2={plotHeight}
										stroke="currentColor"
										strokeOpacity={0.15}
										strokeDasharray="2 4"
									/>
									<rect
										x={x - BAR_WIDTH / 2}
										y={yStart}
										width={BAR_WIDTH}
										height={height}
										rx={2}
										fill={color}
										fillOpacity={0.85}
									>
										<title>
											{`${getShortType(lane.agent.agentType)} · ${formatDuration(lane.endMs - lane.startMs)}`}
										</title>
									</rect>
									{lane.waiting.map((range, j) => {
										const wy = timeAt(range.startMs - layout.startMs, layout.totalMs, plotHeight);
										const wEnd = timeAt(range.endMs - layout.startMs, layout.totalMs, plotHeight);
										const wHeight = Math.max(wEnd - wy, MIN_BAR_HEIGHT);
										return (
											<rect
												key={j}
												x={x - BAR_WIDTH / 2}
												y={wy}
												width={BAR_WIDTH}
												height={wHeight}
												rx={2}
												fill="url(#sequence-waiting-pattern)"
											>
												<title>{`waiting ${formatDuration(range.endMs - range.startMs)}`}</title>
											</rect>
										);
									})}
								</g>
							);
						})}

						{layout.spawns.map((arrow, i) => {
							const x1 = columnX(arrow.parentColumn);
							const x2 = columnX(arrow.childColumn);
							const y = timeAt(arrow.atMs - layout.startMs, layout.totalMs, plotHeight);
							const dir = x2 >= x1 ? 1 : -1;
							const startX = x1 + dir * (BAR_WIDTH / 2);
							const endX = x2 - dir * (BAR_WIDTH / 2);
							return (
								<line
									key={`spawn-${i}`}
									x1={startX}
									y1={y}
									x2={endX}
									y2={y}
									stroke="currentColor"
									strokeOpacity={0.7}
									strokeWidth={1.5}
									markerEnd="url(#sequence-arrow-solid)"
									className="text-accent-100"
								>
									<title>spawn</title>
								</line>
							);
						})}

						{layout.returns.map((arrow, i) => {
							const x1 = columnX(arrow.childColumn);
							const x2 = columnX(arrow.parentColumn);
							const y = timeAt(arrow.atMs - layout.startMs, layout.totalMs, plotHeight);
							const dir = x2 >= x1 ? 1 : -1;
							const startX = x1 + dir * (BAR_WIDTH / 2);
							const endX = x2 - dir * (BAR_WIDTH / 2);
							return (
								<line
									key={`return-${i}`}
									x1={startX}
									y1={y}
									x2={endX}
									y2={y}
									stroke="currentColor"
									strokeOpacity={0.6}
									strokeWidth={1.25}
									strokeDasharray="4 3"
									markerEnd="url(#sequence-arrow-dashed)"
									className="text-t6"
								>
									<title>return</title>
								</line>
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
				<span className="flex items-center gap-1">
					<svg width="22" height="8" className="text-accent-100">
						<line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="1.5" />
						<polygon points="18,1 22,4 18,7" fill="currentColor" />
					</svg>
					spawn
				</span>
				<span className="flex items-center gap-1">
					<svg width="22" height="8" className="text-t6">
						<line
							x1="0"
							y1="4"
							x2="18"
							y2="4"
							stroke="currentColor"
							strokeWidth="1.25"
							strokeDasharray="4 3"
						/>
						<polygon points="18,1 22,4 18,7" fill="currentColor" />
					</svg>
					return
				</span>
			</div>
		</div>
	);
}
