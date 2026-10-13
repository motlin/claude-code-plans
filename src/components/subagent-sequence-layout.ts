import type {Subagent} from "../lib/subagents";

export function layoutSequence(agents: Subagent[]): SequenceLayout {
	const spans = timedSpans(agents);
	const timed = spans.map((span) => span.agent);

	if (timed.length === 0) {
		return {
			lifelines: [],
			spawns: [],
			returns: [],
			startMs: 0,
			endMs: 0,
			totalMs: 0,
			ticks: [],
		};
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

	const ordered = [...spans].sort((a, b) => {
		if (a.startMs !== b.startMs) return a.startMs - b.startMs;
		const aDepth = depthOf.get(a.agent.id) ?? 0;
		const bDepth = depthOf.get(b.agent.id) ?? 0;
		if (aDepth !== bDepth) return aDepth - bDepth;
		return a.agent.id.localeCompare(b.agent.id);
	});

	const columnOf = new Map<string, number>();
	ordered.forEach((span, i) => columnOf.set(span.agent.id, i));

	const lifelines: SequenceLifeline[] = ordered.map(({agent, startMs, endMs}, column) => {
		const childRanges: SequenceTimeRange[] = (childrenByParent.get(agent.id) ?? [])
			.map((c) => ({startMs: c.startMs, endMs: c.endMs}))
			.filter((r) => r.endMs > r.startMs);
		return {
			agent,
			column,
			depth: depthOf.get(agent.id) ?? 0,
			startMs,
			endMs,
			waiting: mergeRanges(childRanges),
		};
	});

	const spawns: SequenceSpawnArrow[] = [];
	const returns: SequenceReturnArrow[] = [];
	for (const [childColumn, {agent: child, startMs, endMs}] of ordered.entries()) {
		const parentId = child.parentAgentId;
		if (!parentId) continue;
		const parentColumn = columnOf.get(parentId);
		if (parentColumn === undefined) continue;
		spawns.push({
			parentId,
			childId: child.id,
			parentColumn,
			childColumn,
			atMs: startMs,
		});
		returns.push({
			parentId,
			childId: child.id,
			parentColumn,
			childColumn,
			atMs: endMs,
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

interface SequenceTimeRange {
	startMs: number;
	endMs: number;
}

interface SequenceLifeline {
	agent: Subagent;
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

export interface SequenceLayout {
	lifelines: SequenceLifeline[];
	spawns: SequenceSpawnArrow[];
	returns: SequenceReturnArrow[];
	startMs: number;
	endMs: number;
	totalMs: number;
	ticks: SequenceTick[];
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

function mergeRanges(ranges: SequenceTimeRange[]): SequenceTimeRange[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
	const merged: SequenceTimeRange[] = [];
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

function buildTicks(totalMs: number): SequenceTick[] {
	if (totalMs <= 0) return [{offsetMs: 0, label: "0s"}];
	const {intervalMs, format} = pickTickInterval(totalMs);
	const ticks: SequenceTick[] = [];
	for (let t = 0; t <= totalMs; t += intervalMs) {
		ticks.push({offsetMs: t, label: format(t)});
	}
	if ((ticks.at(-1)?.offsetMs ?? 0) < totalMs) {
		ticks.push({offsetMs: totalMs, label: format(totalMs)});
	}
	return ticks;
}

interface SequenceTick {
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
