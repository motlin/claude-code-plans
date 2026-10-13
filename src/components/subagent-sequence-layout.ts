import type {Subagent} from "../lib/subagents";

export function layoutSequence(agents: Subagent[]): SequenceLayout {
	const timed = agents.filter((a) => toMsOrNull(a.startedAt) !== null && toMsOrNull(a.finishedAt) !== null);

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
	const childrenByParent = new Map<string, Subagent[]>();
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

function buildTicks(totalMs: number): SequenceTick[] {
	if (totalMs <= 0) return [{offsetMs: 0, label: "0s"}];
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
		{intervalMs: hour, format: (ms) => `${Math.round(ms / hour)}h`},
	];
	for (const c of candidates) {
		if (totalMs / c.intervalMs <= 10) return c;
	}
	return candidates[candidates.length - 1]!;
}
