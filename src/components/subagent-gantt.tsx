import {useMemo, useState} from 'react';
import {Activity} from 'lucide-react';
import type {DbSubagent} from '../lib/db/queries';
import {formatDuration} from './tool-renderers/shared';

export interface TimeRange {
	startMs: number;
	endMs: number;
}

export interface SwimlaneTick {
	offsetMs: number;
	label: string;
}

export interface Swimlane {
	agent: DbSubagent;
	depth: number;
	startMs: number;
	endMs: number;
	waiting: TimeRange[];
}

export interface SwimlaneLayout {
	lanes: Swimlane[];
	startMs: number;
	endMs: number;
	totalMs: number;
	ticks: SwimlaneTick[];
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

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
	const merged: TimeRange[] = [sorted[0]!];
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

function buildTicks(totalMs: number): SwimlaneTick[] {
	if (totalMs <= 0) return [{offsetMs: 0, label: '0s'}];
	const {intervalMs, format} = pickTickInterval(totalMs);
	const ticks: SwimlaneTick[] = [];
	for (let t = 0; t <= totalMs; t += intervalMs) {
		ticks.push({offsetMs: t, label: format(t)});
	}
	if (ticks[ticks.length - 1]!.offsetMs < totalMs) {
		ticks.push({offsetMs: totalMs, label: format(totalMs)});
	}
	return ticks;
}

export function layoutSwimlanes(agents: DbSubagent[]): SwimlaneLayout {
	const timed = agents.filter((a) => toMsOrNull(a.startedAt) !== null && toMsOrNull(a.finishedAt) !== null);

	if (timed.length === 0) {
		return {lanes: [], startMs: 0, endMs: 0, totalMs: 0, ticks: []};
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

	const lanes: Swimlane[] = timed.map((agent) => {
		const startMs = toMsOrNull(agent.startedAt)!;
		const endMs = toMsOrNull(agent.finishedAt)!;
		const childRanges: TimeRange[] = (childrenByParent.get(agent.id) ?? [])
			.map((c) => ({
				startMs: toMsOrNull(c.startedAt)!,
				endMs: toMsOrNull(c.finishedAt)!,
			}))
			.filter((r) => r.endMs > r.startMs);
		return {
			agent,
			depth: depthOf.get(agent.id) ?? 0,
			startMs,
			endMs,
			waiting: mergeRanges(childRanges),
		};
	});

	lanes.sort((a, b) => {
		if (a.startMs !== b.startMs) return a.startMs - b.startMs;
		if (a.depth !== b.depth) return a.depth - b.depth;
		return a.agent.id.localeCompare(b.agent.id);
	});

	const startMs = Math.min(...lanes.map((l) => l.startMs));
	const endMs = Math.max(...lanes.map((l) => l.endMs));
	const totalMs = Math.max(0, endMs - startMs);

	return {
		lanes,
		startMs,
		endMs,
		totalMs,
		ticks: buildTicks(totalMs),
	};
}

const LABEL_COL_W = 200;
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

export function SubagentGantt({agents}: {agents: DbSubagent[]}) {
	const layout = useMemo(() => layoutSwimlanes(agents), [agents]);
	const [zoom, setZoom] = useState<ZoomLevel>(1);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	if (layout.lanes.length === 0) {
		return null;
	}

	const basePlotWidth = 720;
	const plotWidth = basePlotWidth * zoom;
	const totalWidth = LABEL_COL_W + plotWidth + PADDING_X * 2;
	const totalHeight = HEADER_HEIGHT + layout.lanes.length * (LANE_HEIGHT + LANE_GAP) + PADDING_Y * 2;

	return (
		<div className="mt-3">
			<div className="flex items-center justify-between mb-1">
				<h2 className="text-xs font-semibold text-text-500 uppercase tracking-wide flex items-center gap-2">
					<Activity size={12} />
					Subagent timeline
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
								className="text-text-500/40"
							/>
						</pattern>
					</defs>

					<g
						transform={`translate(${LABEL_COL_W + PADDING_X}, ${PADDING_Y})`}
						className="text-text-500"
					>
						{layout.ticks.map((tick, i) => {
							const x = timeAt(tick.offsetMs, layout.totalMs, plotWidth);
							return (
								<g key={i}>
									<line
										x1={x}
										y1={HEADER_HEIGHT - 4}
										x2={x}
										y2={HEADER_HEIGHT + layout.lanes.length * (LANE_HEIGHT + LANE_GAP)}
										stroke="currentColor"
										strokeOpacity={0.1}
										strokeWidth={1}
									/>
									<text
										x={x}
										y={HEADER_HEIGHT - 8}
										fontSize={10}
										textAnchor={
											i === 0 ? 'start' : i === layout.ticks.length - 1 ? 'end' : 'middle'
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
						{layout.lanes.map((lane, i) => {
							const y = i * (LANE_HEIGHT + LANE_GAP);
							const xStart = timeAt(lane.startMs - layout.startMs, layout.totalMs, plotWidth);
							const widthRaw = timeAt(lane.endMs - lane.startMs, layout.totalMs, plotWidth);
							const width = Math.max(widthRaw, MIN_BAR_WIDTH);
							const color = getBarColor(lane.agent.agentType);
							const dimmed = hoveredId !== null && hoveredId !== lane.agent.id;
							return (
								<g
									key={lane.agent.id}
									onMouseEnter={() => setHoveredId(lane.agent.id)}
									onMouseLeave={() => setHoveredId(null)}
									style={{opacity: dimmed ? 0.35 : 1, transition: 'opacity 0.15s'}}
								>
									<text
										x={PADDING_X + lane.depth * 10}
										y={y + LANE_HEIGHT / 2 + 4}
										fontSize={11}
										fill="currentColor"
										className="text-text-100"
									>
										{truncate(getShortType(lane.agent.agentType), 12)}
									</text>
									<text
										x={PADDING_X + lane.depth * 10 + 70}
										y={y + LANE_HEIGHT / 2 + 4}
										fontSize={10}
										fill="currentColor"
										className="text-text-500"
									>
										{truncate(lane.agent.description ?? lane.agent.slug ?? '', 14)}
									</text>

									<rect
										x={LABEL_COL_W + PADDING_X}
										y={y}
										width={plotWidth}
										height={LANE_HEIGHT}
										fill="currentColor"
										fillOpacity={0.03}
										className="text-text-500"
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
													<title>
														{`waiting ${formatDuration(range.endMs - range.startMs)}`}
													</title>
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
			</div>
		</div>
	);
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + '\u2026';
}
