import type {Subagent} from "./subagents";
import {phaseStatus, UNPHASED_INDEX} from "./workflow-phase";
import type {PhaseStatus, WorkflowProgressCounts, WorkflowRunStatus} from "./workflow-progress";

export interface SubagentTreeNode {
	agent: Subagent;
	children: SubagentTreeEntry[];
}

export interface ParallelSubagentGroup {
	type: "parallel";
	children: SubagentTreeNode[];
	wallClockMs: number;
}

/** One phase of a workflow run, bucketed by upstream's progress-model rules (c62da1b56 `ge`). */
export interface WorkflowPhaseGroup {
	type: "workflow-phase";
	index: number;
	title: string;
	counts: WorkflowProgressCounts;
	status: PhaseStatus;
	agents: SubagentTreeNode[];
	/** Earlier attempts of a resumed run, which upstream hides; kept out of `counts`. */
	supersededAgents: SubagentTreeNode[];
}

/** A workflow run's agents, grouped by phase; it sorts among root entries by its earliest agent. */
export interface WorkflowRunGroup {
	type: "workflow-run";
	runId: string;
	name: string;
	startedAt: string | null;
	durationMs: number;
	agentCount: number;
	/** The run has ended: its phases default to collapsed (upstream's default). */
	settled: boolean;
	phases: WorkflowPhaseGroup[];
}

export type SubagentTreeEntry = SubagentTreeNode | ParallelSubagentGroup | WorkflowRunGroup;

/** What the tree knows about a session's workflow launches. */
export interface WorkflowRunInfo {
	runId: string;
	workflowName: string;
	status?: WorkflowRunStatus;
}

export interface SubagentDateGroup {
	key: string;
	label: string;
	entries: SubagentTreeEntry[];
}

function compareStartedAt(left: Subagent, right: Subagent): number {
	if (left.startedAt === right.startedAt) return left.id.localeCompare(right.id);
	if (left.startedAt === null) return 1;
	if (right.startedAt === null) return -1;
	return left.startedAt.localeCompare(right.startedAt);
}

function durationMs(agent: Subagent): number {
	if (agent.startedAt === null || agent.finishedAt === null) return 0;
	return new Date(agent.finishedAt).getTime() - new Date(agent.startedAt).getTime();
}

function entryStartedAt(entry: SubagentTreeEntry): string | null {
	if (!("type" in entry)) return entry.agent.startedAt;
	return entry.type === "workflow-run" ? entry.startedAt : (entry.children[0]?.agent.startedAt ?? null);
}

function compareEntries(left: SubagentTreeEntry, right: SubagentTreeEntry): number {
	const leftStartedAt = entryStartedAt(left);
	const rightStartedAt = entryStartedAt(right);
	if (leftStartedAt === rightStartedAt) return 0;
	if (leftStartedAt === null) return 1;
	if (rightStartedAt === null) return -1;
	return leftStartedAt.localeCompare(rightStartedAt);
}

const ZERO_COUNTS: WorkflowProgressCounts = {
	done: 0,
	running: 0,
	stalled: 0,
	error: 0,
	stopped: 0,
	pending: 0,
	total: 0,
};

function buildWorkflowRun(
	runId: string,
	agents: Subagent[],
	info: WorkflowRunInfo | undefined,
	toNode: (agent: Subagent) => SubagentTreeNode,
): WorkflowRunGroup {
	agents.sort(compareStartedAt);
	const finalAgents = agents.filter((agent) => agent.workflowAttempt !== "superseded");
	const settled =
		info?.status === undefined
			? finalAgents.every((agent) => agent.finishedAt !== null)
			: info.status !== "running";
	const byIndex = new Map<number, WorkflowPhaseGroup>();
	for (const agent of agents) {
		const index = agent.workflowPhaseIndex ?? UNPHASED_INDEX;
		let phase = byIndex.get(index);
		if (phase === undefined) {
			phase = {
				type: "workflow-phase",
				index,
				title: agent.workflowPhase ?? `Phase ${index}`,
				counts: {...ZERO_COUNTS},
				status: "pending",
				agents: [],
				supersededAgents: [],
			};
			byIndex.set(index, phase);
		} else if (agent.workflowPhase && phase.title === `Phase ${index}`) {
			phase.title = agent.workflowPhase;
		}
		if (agent.workflowAttempt === "superseded") {
			phase.supersededAgents.push(toNode(agent));
			continue;
		}
		phase.agents.push(toNode(agent));
		phase.counts.total += 1;
		if (agent.workflowState === "failed") phase.counts.error += 1;
		else if (agent.finishedAt === null) phase.counts.running += 1;
		else phase.counts.done += 1;
	}
	const unphased = byIndex.get(UNPHASED_INDEX);
	if (unphased) unphased.title = byIndex.size > 1 ? "Other agents" : "Agents";
	const phases = [...byIndex.values()].toSorted((left, right) => left.index - right.index);
	for (const phase of phases) phase.status = phaseStatus(phase.counts, settled);

	const starts = agents.flatMap((agent) => (agent.startedAt === null ? [] : [new Date(agent.startedAt).getTime()]));
	const finishes = agents.flatMap((agent) =>
		agent.finishedAt === null ? [] : [new Date(agent.finishedAt).getTime()],
	);
	const durationMs =
		starts.length === 0 || finishes.length === 0 ? 0 : Math.max(0, Math.max(...finishes) - Math.min(...starts));
	return {
		type: "workflow-run",
		runId,
		name: info?.workflowName ?? runId,
		startedAt: agents[0]?.startedAt ?? null,
		durationMs,
		agentCount: finalAgents.length,
		settled,
		phases,
	};
}

function localDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dateGroupLabel(date: Date, now: Date): string {
	const key = localDateKey(date);
	if (key === localDateKey(now)) return "Today";

	const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	if (key === localDateKey(yesterday)) return "Yesterday";

	return date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

export function groupSubagentTreeByDate(entries: SubagentTreeEntry[], now = new Date()): SubagentDateGroup[] {
	const groups: SubagentDateGroup[] = [];

	for (const entry of entries) {
		const startedAt = entryStartedAt(entry);
		const date = startedAt === null ? null : new Date(startedAt);
		const key = date === null ? "unknown" : localDateKey(date);
		const previousGroup = groups.at(-1);

		if (previousGroup?.key === key) {
			previousGroup.entries.push(entry);
			continue;
		}

		groups.push({
			key,
			label: date === null ? "Unknown date" : dateGroupLabel(date, now),
			entries: [entry],
		});
	}

	return groups;
}

export function buildSubagentTree(
	agents: Subagent[],
	options?: {workflowRuns?: readonly WorkflowRunInfo[]},
): SubagentTreeEntry[] {
	const agentsByParent = new Map<string | null, Subagent[]>();
	const agentsByRun = new Map<string, Subagent[]>();
	for (const agent of agents) {
		if (agent.workflowRunId) {
			const runAgents = agentsByRun.get(agent.workflowRunId) ?? [];
			runAgents.push(agent);
			agentsByRun.set(agent.workflowRunId, runAgents);
			continue;
		}
		const siblings = agentsByParent.get(agent.parentAgentId) ?? [];
		siblings.push(agent);
		agentsByParent.set(agent.parentAgentId, siblings);
	}

	function buildChildren(parentAgentId: string | null): SubagentTreeEntry[] {
		const children = agentsByParent.get(parentAgentId);
		if (children === undefined) return [];

		children.sort(compareStartedAt);
		const entries: SubagentTreeEntry[] = [];

		for (let index = 0; index < children.length; index++) {
			const first = children[index];
			if (first === undefined) break;
			const parallelAgents = [first];
			const firstStartedAt = first.startedAt === null ? null : new Date(first.startedAt).getTime();

			for (let next = children[index + 1]; next !== undefined; next = children[index + 1]) {
				const nextStartedAt = next.startedAt === null ? null : new Date(next.startedAt).getTime();
				if (
					firstStartedAt === null ||
					nextStartedAt === null ||
					Math.abs(nextStartedAt - firstStartedAt) >= 2_000
				) {
					break;
				}
				parallelAgents.push(next);
				index++;
			}

			const nodes = parallelAgents.map((agent) => ({
				agent,
				children: buildChildren(agent.id),
			}));
			const [only] = nodes;
			if (only !== undefined && nodes.length === 1) {
				entries.push(only);
				continue;
			}

			entries.push({
				type: "parallel",
				children: nodes,
				wallClockMs: Math.max(...parallelAgents.map(durationMs)),
			});
		}

		return entries;
	}

	const roots = buildChildren(null);
	if (agentsByRun.size === 0) return roots;
	const runInfo = new Map(options?.workflowRuns?.map((run) => [run.runId, run]));
	const runs = [...agentsByRun].map(([runId, runAgents]) =>
		buildWorkflowRun(runId, runAgents, runInfo.get(runId), (agent) => ({agent, children: buildChildren(agent.id)})),
	);
	return [...roots, ...runs].toSorted(compareEntries);
}
