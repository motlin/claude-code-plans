import {useMemo, useState} from 'react';
import {Workflow} from 'lucide-react';
import type {DbSubagent} from '../lib/db/queries';
import {formatDuration} from './tool-renderers/shared';

interface SequenceTimeRange {
	startMs: number;
	endMs: number;
}

interface SequenceLifeline {
	agent: DbSubagent;
	column: number;
	depth: number;
	startMs: number;
	endMs: number;
	waiting: SequenceTimeRange[];
}

interface SequenceSpawnArrow {
	parentId: string;
	childId: string;
	parentColumn: number;
	childColumn: number;
	atMs: number;
}

interface SequenceReturnArrow {
	parentId: string;
	childId: string;
	parentColumn: number;
	childColumn: number;
	atMs: number;
}

interface SequenceTick {
	offsetMs: number;
	label: string;
}

export interface SequenceLayout {
	lifelines: SequenceLifeline[];
	spawns: SequenceSpawnArrow[];
	returns: SequenceReturnArrow[];
	startMs: number;
	endMs: number;
	totalMs: number;
	ticks: SequenceTick[];
}

const AGENT_BAR_COLORS: Record<string, string> = {
	Explore: '#3b82f6',
	Plan: '#a855f7',
	'build:precommit-runner': '#eab308',
	'git:commit-handler': '#22c55e',
	'git:rebaser': '#ec4899',
	'markdown-tasks:do-task': '#f97316',
	'general-purpose': '#6b7280',
};

function getBarColor(agentType: string | null): string {
	if (!agentType) return '#6b7280';
	return AGENT_BAR_COLORS[agentType] ?? '#6b7280';
}

function getShortType(agentType: string | null): string {
	if (!agentType) return 'agent';
	const parts = agentType.split(':');
	return parts[parts.length - 1]!;
}

function toMsOrNull(iso: string | null): number | null {
	if (!iso) return null;
	const ms = new Date(iso).getTime();
	return Number.isFinite(ms) ? ms : null;
}

function computeDepths(timed: DbSubagent[]): Map<string, number> {
	const byId = new Map(timed.map((a) => [a.id, a]));
	const depthOf = new Map<string, number>();

	function depth(id: string, seen: Set<string>): number {
		const cached = depthOf.get(id);
		if (cached !== undefined) return cached;
		if (seen.has(id)) return 0;
		seen.add(id);
		const agent = byId.get(id);
		if (!agent || !agent.parentAgentId || !byId.has(agent.parentAgentId)) {
			depthOf.set(id, 0);
			return 0;
		}
		const d = depth(agent.parentAgentId, seen) + 1;
		depthOf.set(id, d);
		return d;
	}

	for (const agent of timed) depth(agent.id, new Set());
	return depthOf;
}

function mergeRanges(ranges: SequenceTimeRange[]): SequenceTimeRange[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
	const merged: SequenceTimeRange[] = [sorted[0]!];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1]!;
		const next = sorted[i]!;
		if (next.startMs <= last.endMs) {
			if (next.endMs > last.endMs) last.endMs = next.endMs;
		} else {
			merged.push({...next});
		}
	}
	return merged;
}

function pickTickInterval(totalMs: number): {intervalMs: number; format: (ms: number) => string} {
	const sec = 1000;
	const min = 60 * sec;
	const hour = 60 * min;
	const candidates: Array<{intervalMs: number; format: (ms: number) => string}> = [
		{intervalMs: sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: 5 * sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: 15 * sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: 30 * sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: 5 * min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: 15 * min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: 30 * min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: hour, format: (ms) => `${Math.round(ms / hour)}h`},
	];
	for (const c of candidates) {
		if (totalMs / c.intervalMs <= 10) return c;
	}
	return candidates[candidates.length - 1]!;
}

function buildTicks(totalMs: number): SequenceTick[] {
	if (totalMs <= 0) return [{offsetMs: 0, label: '0s'}];
	const {intervalMs, format} = pickTickInterval(totalMs);
	const ticks: SequenceTick[] = [];
	for (let t = 0; t <= totalMs; t += intervalMs) {
		ticks.push({offsetMs: t, label: format(t)});
	}
	if (ticks[ticks.length - 1]!.offsetMs < totalMs) {
		ticks.push({offsetMs: totalMs, label: format(totalMs)});
	}
	return ticks;
}

export function layoutSequence(agents: DbSubagent[]): SequenceLayout {
	const timed = agents.filter((a) => toMsOrNull(a.startedAt) !== null && toMsOrNull(a.finishedAt) !== null);

	if (timed.length === 0) {
		return {lifelines: [], spawns: [], returns: [], startMs: 0, endMs: 0, totalMs: 0, ticks: []};
	}

	const depthOf = computeDepths(timed);
	const childrenByParent = new Map<string, DbSubagent[]>();
	for (const a of timed) {
		const key = a.parentAgentId;
		if (!key) continue;
		const list = childrenByParent.get(key) ?? [];
		list.push(a);
		childrenByParent.set(key, list);
	}

	const ordered = [...timed].sort((a, b) => {
		const aMs = toMsOrNull(a.startedAt)!;
		const bMs = toMsOrNull(b.startedAt)!;
		if (aMs !== bMs) return aMs - bMs;
		const aDepth = depthOf.get(a.id) ?? 0;
		const bDepth = depthOf.get(b.id) ?? 0;
		if (aDepth !== bDepth) return aDepth - bDepth;
		return a.id.localeCompare(b.id);
	});

	const columnOf = new Map<string, number>();
	ordered.forEach((agent, i) => columnOf.set(agent.id, i));

	const lifelines: SequenceLifeline[] = ordered.map((agent) => {
		const startMs = toMsOrNull(agent.startedAt)!;
		const endMs = toMsOrNull(agent.finishedAt)!;
		const childRanges: SequenceTimeRange[] = (childrenByParent.get(agent.id) ?? [])
			.map((c) => ({
				startMs: toMsOrNull(c.startedAt)!,
				endMs: toMsOrNull(c.finishedAt)!,
			}))
			.filter((r) => r.endMs > r.startMs);
		return {
			agent,
			column: columnOf.get(agent.id)!,
			depth: depthOf.get(agent.id) ?? 0,
			startMs,
			endMs,
			waiting: mergeRanges(childRanges),
		};
	});

	const spawns: SequenceSpawnArrow[] = [];
	const returns: SequenceReturnArrow[] = [];
	for (const child of ordered) {
		const parentId = child.parentAgentId;
		if (!parentId || !columnOf.has(parentId)) continue;
		const parentColumn = columnOf.get(parentId)!;
		const childColumn = columnOf.get(child.id)!;
		spawns.push({
			parentId,
			childId: child.id,
			parentColumn,
			childColumn,
			atMs: toMsOrNull(child.startedAt)!,
		});
		returns.push({
			parentId,
			childId: child.id,
			parentColumn,
			childColumn,
			atMs: toMsOrNull(child.finishedAt)!,
		});
	}

	const startMs = Math.min(...lifelines.map((l) => l.startMs));
	const endMs = Math.max(...lifelines.map((l) => l.endMs));
	const totalMs = Math.max(0, endMs - startMs);

	return {
		lifelines,
		spawns,
		returns,
		startMs,
		endMs,
		totalMs,
		ticks: buildTicks(totalMs),
	};
}

const COLUMN_WIDTH = 96;
const HEADER_HEIGHT = 56;
const TIME_AXIS_WIDTH = 56;
const PADDING_X = 12;
const PADDING_Y = 12;
const BAR_WIDTH = 12;
const MIN_BAR_HEIGHT = 2;

const ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;
type ZoomLevel = (typeof ZOOM_LEVELS)[number];

function timeAt(offsetMs: number, totalMs: number, plotHeight: number): number {
	if (totalMs === 0) return 0;
	return (offsetMs / totalMs) * plotHeight;
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + '\u2026';
}

export function SubagentSequence({agents}: {agents: DbSubagent[]}) {
	const layout = useMemo(() => layoutSequence(agents), [agents]);
	const [zoom, setZoom] = useState<ZoomLevel>(1);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	if (layout.lifelines.length === 0) {
		return null;
	}

	const basePlotHeight = 360;
	const plotHeight = basePlotHeight * zoom;
	const totalWidth = TIME_AXIS_WIDTH + layout.lifelines.length * COLUMN_WIDTH + PADDING_X * 2;
	const totalHeight = HEADER_HEIGHT + plotHeight + PADDING_Y * 2;

	const columnX = (column: number) => TIME_AXIS_WIDTH + PADDING_X + column * COLUMN_WIDTH + COLUMN_WIDTH / 2;

	return (
		<div className="mt-3">
			<div className="flex items-center justify-between mb-1">
				<h2 className="text-xs font-semibold text-text-500 uppercase tracking-wide flex items-center gap-2">
					<Workflow size={12} />
					Subagent sequence
				</h2>
				<div
					className="flex items-center gap-1 text-[10px] text-text-500"
					role="group"
					aria-label="Zoom level"
				>
					<span>Zoom</span>
					{ZOOM_LEVELS.map((z) => (
						<button
							key={z}
							type="button"
							onClick={() => setZoom(z)}
							aria-pressed={zoom === z}
							className={`rounded px-1.5 py-0.5 tabular-nums ${
								zoom === z ? 'bg-accent-000/15 text-accent-100' : 'hover:bg-bg-200/50 text-text-500'
							}`}
						>
							{z}x
						</button>
					))}
				</div>
			</div>
			<div className="overflow-auto rounded-md border border-border-300/30 bg-bg-100/40">
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
								className="text-text-500/40"
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
							<path
								d="M 0 0 L 10 5 L 0 10 z"
								fill="currentColor"
							/>
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
							<path
								d="M 0 0 L 10 5 L 0 10 z"
								fill="currentColor"
							/>
						</marker>
					</defs>

					<g
						transform={`translate(0, ${PADDING_Y})`}
						className="text-text-500"
					>
						{layout.lifelines.map((lane) => {
							const x = columnX(lane.column);
							const dimmed = hoveredId !== null && hoveredId !== lane.agent.id;
							return (
								<g
									key={`header-${lane.agent.id}`}
									style={{opacity: dimmed ? 0.35 : 1, transition: 'opacity 0.15s'}}
									onMouseEnter={() => setHoveredId(lane.agent.id)}
									onMouseLeave={() => setHoveredId(null)}
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
										className="text-text-100"
									>
										{truncate(getShortType(lane.agent.agentType), 12)}
									</text>
									<text
										x={x}
										y={34}
										fontSize={9}
										textAnchor="middle"
										fill="currentColor"
										className="text-text-500"
									>
										{truncate(lane.agent.description ?? lane.agent.slug ?? '', 14)}
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
											className="text-text-500"
										>
											{`d${lane.depth}`}
										</text>
									</g>
								</g>
							);
						})}
					</g>

					<g
						transform={`translate(0, ${PADDING_Y + HEADER_HEIGHT})`}
						className="text-text-500"
					>
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
									style={{opacity: dimmed ? 0.35 : 1, transition: 'opacity 0.15s'}}
									onMouseEnter={() => setHoveredId(lane.agent.id)}
									onMouseLeave={() => setHoveredId(null)}
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
												<title>
													{`waiting ${formatDuration(range.endMs - range.startMs)}`}
												</title>
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
									className="text-text-500"
								>
									<title>return</title>
								</line>
							);
						})}
					</g>
				</svg>
			</div>
			<div className="mt-2 flex items-center gap-3 text-[10px] text-text-500">
				<span className="flex items-center gap-1">
					<span
						className="inline-block w-3 h-3 rounded-sm"
						style={{background: '#6b7280', opacity: 0.85}}
					/>
					active
				</span>
				<span className="flex items-center gap-1">
					<span
						className="inline-block w-3 h-3 rounded-sm border border-text-500/30"
						style={{
							backgroundImage:
								'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)',
							color: 'rgb(107 114 128 / 0.6)',
						}}
					/>
					waiting on child
				</span>
				<span className="flex items-center gap-1">
					<svg
						width="22"
						height="8"
						className="text-accent-100"
					>
						<line
							x1="0"
							y1="4"
							x2="18"
							y2="4"
							stroke="currentColor"
							strokeWidth="1.5"
						/>
						<polygon
							points="18,1 22,4 18,7"
							fill="currentColor"
						/>
					</svg>
					spawn
				</span>
				<span className="flex items-center gap-1">
					<svg
						width="22"
						height="8"
						className="text-text-500"
					>
						<line
							x1="0"
							y1="4"
							x2="18"
							y2="4"
							stroke="currentColor"
							strokeWidth="1.25"
							strokeDasharray="4 3"
						/>
						<polygon
							points="18,1 22,4 18,7"
							fill="currentColor"
						/>
					</svg>
					return
				</span>
			</div>
		</div>
	);
}
