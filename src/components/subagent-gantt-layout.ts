import type {WorkflowRunInfo} from "../lib/subagent-tree";
import type {Subagent} from "../lib/subagents";
import {orderByWorkflowRun} from "../lib/workflow-lane-groups";

export function layoutSwimlanes(
	agents: Subagent[],
	options?: {workflowRuns?: readonly WorkflowRunInfo[] | undefined},
): SwimlaneLayout {
	const spans = timedSpans(agents);
	const timed = spans.map((span) => span.agent);

	if (timed.length === 0) {
		return {lanes: [], groups: [], startMs: 0, endMs: 0, totalMs: 0, ticks: []};
	}

	const depthOf = computeDepths(timed);
	const childrenByParent = new Map<string, TimedSpan[]>();
	for (const span of spans) {
		const key = span.agent.parentAgentId;
		if (!key) continue;
		const list = childrenByParent.get(key) ?? [];
		list.push(span);
		childrenByParent.set(key, list);
	}

	const unordered: Swimlane[] = spans.map(({agent, startMs, endMs}) => {
		const childRanges: TimeRange[] = (childrenByParent.get(agent.id) ?? [])
			.map((c) => ({startMs: c.startMs, endMs: c.endMs}))
			.filter((r) => r.endMs > r.startMs);
		return {
			agent,
			depth: depthOf.get(agent.id) ?? 0,
			startMs,
			endMs,
			waiting: mergeRanges(childRanges),
		};
	});

	const {ordered: lanes, groups} = orderByWorkflowRun(
		unordered,
		(a, b) => {
			if (a.startMs !== b.startMs) return a.startMs - b.startMs;
			if (a.depth !== b.depth) return a.depth - b.depth;
			return a.agent.id.localeCompare(b.agent.id);
		},
		options?.workflowRuns,
	);

	const startMs = Math.min(...lanes.map((l) => l.startMs));
	const endMs = Math.max(...lanes.map((l) => l.endMs));
	const totalMs = Math.max(0, endMs - startMs);

	return {
		lanes,
		groups: groups.map(({runId, name, phaseTitle, first, count}) => ({
			runId,
			name,
			phaseTitle,
			firstLane: first,
			laneCount: count,
		})),
		startMs,
		endMs,
		totalMs,
		ticks: buildTicks(totalMs),
	};
}

interface TimeRange {
	startMs: number;
	endMs: number;
}

interface Swimlane {
	agent: Subagent;
	depth: number;
	startMs: number;
	endMs: number;
	waiting: TimeRange[];
}

/** The lanes `[firstLane, firstLane + laneCount)` of one phase of a workflow run. */
interface SwimlaneGroup {
	runId: string;
	name: string;
	phaseTitle: string;
	firstLane: number;
	laneCount: number;
}

export interface SwimlaneLayout {
	lanes: Swimlane[];
	groups: SwimlaneGroup[];
	startMs: number;
	endMs: number;
	totalMs: number;
	ticks: SwimlaneTick[];
}

interface TimedSpan {
	agent: Subagent;
	startMs: number;
	endMs: number;
}

/** Agents with a parseable start and finish, paired with those timestamps in ms. */
function timedSpans(agents: Subagent[]): TimedSpan[] {
	return agents.flatMap((agent) => {
		const startMs = toMsOrNull(agent.startedAt);
		const endMs = toMsOrNull(agent.finishedAt);
		return startMs === null || endMs === null ? [] : [{agent, startMs, endMs}];
	});
}

function toMsOrNull(iso: string | null): number | null {
	if (!iso) return null;
	const ms = new Date(iso).getTime();
	return Number.isFinite(ms) ? ms : null;
}

function computeDepths(timed: Subagent[]): Map<string, number> {
	const byId = new Map(timed.map((a) => [a.id, a]));
	const depthOf = new Map<string, number>();

	function depth(id: string, seen: Set<string>): number {
		const cached = depthOf.get(id);
		if (cached !== undefined) return cached;
		if (seen.has(id)) return 0;
		seen.add(id);
		const agent = byId.get(id);
		if (!agent?.parentAgentId || !byId.has(agent.parentAgentId)) {
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
	const sorted = ranges.toSorted((a, b) => a.startMs - b.startMs);
	const merged: TimeRange[] = [];
	for (const next of sorted) {
		const last = merged.at(-1);
		if (last !== undefined && next.startMs <= last.endMs) {
			if (next.endMs > last.endMs) last.endMs = next.endMs;
		} else {
			merged.push({...next});
		}
	}
	return merged;
}

function buildTicks(totalMs: number): SwimlaneTick[] {
	if (totalMs <= 0) return [{offsetMs: 0, label: "0s"}];
	const {intervalMs, format} = pickTickInterval(totalMs);
	const ticks: SwimlaneTick[] = [];
	for (let t = 0; t <= totalMs; t += intervalMs) {
		ticks.push({offsetMs: t, label: format(t)});
	}
	if ((ticks.at(-1)?.offsetMs ?? 0) < totalMs) {
		ticks.push({offsetMs: totalMs, label: format(totalMs)});
	}
	return ticks;
}

interface SwimlaneTick {
	offsetMs: number;
	label: string;
}

function pickTickInterval(totalMs: number): {
	intervalMs: number;
	format: (ms: number) => string;
} {
	const sec = 1000;
	const min = 60 * sec;
	const hour = 60 * min;
	const largest = {intervalMs: hour, format: (ms: number) => `${Math.round(ms / hour)}h`};
	const candidates: Array<{
		intervalMs: number;
		format: (ms: number) => string;
	}> = [
		{intervalMs: sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: 5 * sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: 15 * sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: 30 * sec, format: (ms) => `${Math.round(ms / sec)}s`},
		{intervalMs: min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: 5 * min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: 15 * min, format: (ms) => `${Math.round(ms / min)}m`},
		{intervalMs: 30 * min, format: (ms) => `${Math.round(ms / min)}m`},
		largest,
	];
	for (const c of candidates) {
		if (totalMs / c.intervalMs <= 10) return c;
	}
	return largest;
}
