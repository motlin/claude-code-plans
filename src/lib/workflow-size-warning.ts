/**
 * The workflow size warning model, ported from upstream claude.ai/code chunk cc43287c9-BxA0kd-D
 * (2026-11-10): `_Se` agent counts, `m6` axis, `hSe` projection, `gSe` ratchet and `bSe` picker.
 * A running workflow warns once it schedules more than 25 agents or projects more than 1.5M tokens.
 */
import type {WorkflowProgressEntry} from "./workflow-progress";
import type {WorkflowRun} from "./workflow-runs";

const AGENT_CAP = 25;
const TOKEN_CAP = 1_500_000;
/** Upstream `mSe`: the per-agent projection before any agent has started. */
const DEFAULT_AGENT_TOKENS = 70_000;
const NAME_MAX_CODE_POINTS = 64;

export type SizeAxis = "agents" | "tokens" | "both";

export interface SizeWarning
{
	axis: SizeAxis;
	scheduledAgents: number;
	totalTokens: number;
	projectedTokens: number;
}

export interface AgentCounts
{
	scheduledAgents: number;
	startedAgents: number;
}

export interface SizeCounts extends AgentCounts
{
	totalTokens: number;
}

/** Upstream `h6`'s entries: a task's last warning, or its dismissal. */
export type SizeWarningEntry =
	|
	  {
			warning: SizeWarning;
	  }
	| "dismissed";

export type SizeWarningStore = ReadonlyMap<string, SizeWarningEntry>;

export interface PickedSizeWarning
{
	taskId: string;
	name: string | null;
	warning: SizeWarning;
}

/**
 * Upstream `_Se`: every agent entry is scheduled, queued ones included; started means finished,
 * given a start time, or spending tokens. Local runs never list queued agents (see
 * .llm/upstream-sync/features/workflow-running-queued-agents.md), so a live local run has
 * scheduled = started and projects from its measured per-agent average. A `progress` entry counts
 * as started too: the CLI only sets that state on a started agent, but a local journal agent whose
 * meta file is missing has no start time.
 */
export function agentCounts(progress: readonly WorkflowProgressEntry[]): AgentCounts
{
	let scheduledAgents = 0;
	let startedAgents = 0;
	for (const entry of progress)
	{
		if (entry.type !== "workflow_agent") continue;
		scheduledAgents += 1;
		if (
			entry.state === "done" ||
			entry.state === "error" ||
			entry.state === "progress" ||
			entry.startedAt !== undefined ||
			(entry.tokens ?? 0) > 0
		)
		{
			startedAgents += 1;
		}
	}
	return {
		scheduledAgents,
		startedAgents,
	};
}

/** Upstream `m6`. */
export function sizeAxis(scheduledAgents: number, projectedTokens: number): SizeAxis | undefined
{
	const agents = scheduledAgents > AGENT_CAP;
	const tokens = projectedTokens > TOKEN_CAP;
	if (!agents && !tokens) return undefined;
	if (agents && tokens) return "both";
	return agents ? "agents" : "tokens";
}

/** Upstream `hSe`. */
export function sizeWarning({scheduledAgents, startedAgents, totalTokens}: SizeCounts): SizeWarning | undefined
{
	const perAgent = startedAgents > 0 ? totalTokens / startedAgents : DEFAULT_AGENT_TOKENS;
	const projectedTokens = Math.max(totalTokens, Math.round(perAgent * scheduledAgents));
	const axis = sizeAxis(scheduledAgents, projectedTokens);
	return axis === undefined
		? undefined
		:
			{
				axis,
				scheduledAgents,
				totalTokens,
				projectedTokens,
			};
}

/** Upstream `gSe`: a warning never shrinks while its task runs. */
export function ratchetWarning(next: SizeWarning, prev: SizeWarning | undefined): SizeWarning
{
	if (prev === undefined) return next;
	const scheduledAgents = Math.max(next.scheduledAgents, prev.scheduledAgents);
	const projectedTokens = Math.max(next.projectedTokens, prev.projectedTokens);
	if (scheduledAgents === prev.scheduledAgents && projectedTokens === prev.projectedTokens) return prev;
	return {
		...next,
		scheduledAgents,
		projectedTokens,
		axis: sizeAxis(scheduledAgents, projectedTokens) ?? next.axis,
	};
}

/** A run's size inputs: its agent counts and its tokens, the run file's total else the agents' sum. */
export function runSizeCounts(run: WorkflowRun): SizeCounts
{
	let summed = 0;
	for (const entry of run.progress) if (entry.type === "workflow_agent") summed += entry.tokens ?? 0;
	return {
		...agentCounts(run.progress),
		totalTokens: run.totalTokens ?? summed,
	};
}

/** Upstream `Wg`: the name with whitespace collapsed, clamped to 64 code points plus an ellipsis; undefined when blank. */
export function clampWorkflowName(name: string): string | undefined
{
	const normalized = name.replace(/\s+/g, " ").trim();
	if (normalized === "") return undefined;
	const codePoints = Array.from(normalized);
	return codePoints.length > NAME_MAX_CODE_POINTS
		? `${codePoints.slice(0, NAME_MAX_CODE_POINTS).join("").trimEnd()}…`
		: normalized;
}

/** Upstream `bSe`: the first running, undismissed run whose warning (fresh, ratcheted or stored) exists. */
export function pickSizeWarning(runs: readonly WorkflowRun[], store: SizeWarningStore): PickedSizeWarning | null
{
	for (const run of runs)
	{
		if (run.status !== "running") continue;
		const entry = store.get(run.taskId);
		if (entry === "dismissed") continue;
		const fresh = sizeWarning(runSizeCounts(run));
		const stored = entry?.warning;
		const warning = fresh === undefined ? stored : ratchetWarning(fresh, stored);
		if (warning !== undefined)
		{
			return {
				taskId: run.taskId,
				name: clampWorkflowName(run.workflowName || run.description) ?? null,
				warning,
			};
		}
	}
	return null;
}

/** Upstream's token label: compact notation with at most one fraction digit ("1.6M", "15.3M"). */
export function sizeTokenLabel(tokens: number, locale?: string): string
{
	return new Intl.NumberFormat(
		locale,
		{
			notation: "compact",
			maximumFractionDigits: 1,
		},
	).format(tokens);
}
