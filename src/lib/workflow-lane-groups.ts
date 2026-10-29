import type {WorkflowRunInfo} from "./subagent-tree";
import type {Subagent} from "./subagents";
import {UNPHASED_INDEX} from "./workflow-phase";

/** A contiguous slice of the ordered items that share a workflow run and phase. */
export interface WorkflowLaneGroup {
	runId: string;
	name: string;
	phaseTitle: string;
	first: number;
	count: number;
}

interface Phase<T> {
	index: number;
	title: string | null;
	items: T[];
}

interface RunEntry<T> {
	runId: string;
	startMs: number;
	phases: Map<number, Phase<T>>;
}

/**
 * Orders timeline items so each workflow run's agents sit together, bucketed by phase with
 * the Tree's (upstream c62da1b56) rules: phases by index, untitled → "Phase N", unphased →
 * "Agents" alone or "Other agents" beside phases. Runs sort among the other agents by their
 * earliest start; `compare` orders everything else and the agents within a phase.
 */
export function orderByWorkflowRun<T extends {agent: Subagent; startMs: number}>(
	items: readonly T[],
	compare: (left: T, right: T) => number,
	workflowRuns?: readonly WorkflowRunInfo[],
): {ordered: T[]; groups: WorkflowLaneGroup[]} {
	const sorted = items.toSorted(compare);
	const entries: Array<T | RunEntry<T>> = [];
	const runs = new Map<string, RunEntry<T>>();
	for (const item of sorted) {
		const runId = item.agent.workflowRunId;
		if (!runId) {
			entries.push(item);
			continue;
		}
		let run = runs.get(runId);
		if (run === undefined) {
			run = {runId, startMs: item.startMs, phases: new Map()};
			runs.set(runId, run);
			entries.push(run);
		}
		const index = item.agent.workflowPhaseIndex ?? UNPHASED_INDEX;
		let phase = run.phases.get(index);
		if (phase === undefined) {
			phase = {index, title: null, items: []};
			run.phases.set(index, phase);
		}
		phase.title ??= item.agent.workflowPhase ?? null;
		phase.items.push(item);
	}

	const names = new Map(workflowRuns?.map((run) => [run.runId, run.workflowName]));
	const ordered: T[] = [];
	const groups: WorkflowLaneGroup[] = [];
	for (const entry of entries) {
		if (!("phases" in entry)) {
			ordered.push(entry);
			continue;
		}
		const phases = [...entry.phases.values()].toSorted((left, right) => left.index - right.index);
		for (const phase of phases) {
			const phaseTitle =
				phase.index === UNPHASED_INDEX
					? phases.length > 1
						? "Other agents"
						: "Agents"
					: (phase.title ?? `Phase ${phase.index}`);
			groups.push({
				runId: entry.runId,
				name: names.get(entry.runId) ?? entry.runId,
				phaseTitle,
				first: ordered.length,
				count: phase.items.length,
			});
			ordered.push(...phase.items);
		}
	}
	return {ordered, groups};
}
