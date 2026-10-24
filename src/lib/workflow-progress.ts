/**
 * Workflow progress model, ported from upstream claude.ai/code bundle chunk
 * c62da1b56 (`fe`, `pe`, `ge`, `he`, `Q`, `we`) and the card helpers in
 * c44e562e8 (`Eme`, `Dme`, `Ome`, `jme`, `B$`). It turns a run's
 * `workflowProgress` entries (the CLI's `workflows/<runId>.json`) into phases,
 * per-state counts, agent-cell states and the aria summary.
 */
import {z} from "zod";
import {toLenient} from "./lenient-schema";

export const WorkflowAgentEntryStateSchema = z.enum(["start", "progress", "done", "error"]);

const WorkflowPhaseEntrySchema = z.strictObject({
	type: z.literal("workflow_phase"),
	index: z.number(),
	title: z.string().optional(),
});

const WorkflowAgentEntrySchema = z.strictObject({
	type: z.literal("workflow_agent"),
	index: z.number(),
	label: z.string(),
	agentId: z.string(),
	state: WorkflowAgentEntryStateSchema,
	phaseIndex: z.number().optional(),
	phaseTitle: z.string().optional(),
	model: z.string().optional(),
	startedAt: z.number().optional(),
	queuedAt: z.number().optional(),
	lastProgressAt: z.number().optional(),
	attempt: z.number().optional(),
	cached: z.boolean().optional(),
	lastToolName: z.string().optional(),
	lastToolSummary: z.string().optional(),
	promptPreview: z.string().optional(),
	promptFramed: z.boolean().optional(),
	resultPreview: z.string().optional(),
	tokens: z.number().optional(),
	toolCalls: z.number().optional(),
	durationMs: z.number().optional(),
	error: z.string().optional(),
});

/** One `workflowProgress` entry; deep-strict for the disk-validation test. */
export const WorkflowProgressEntrySchema = z.discriminatedUnion("type", [
	WorkflowPhaseEntrySchema,
	WorkflowAgentEntrySchema,
]);

/** Lenient twin for runtime parsing (see `toLenient`). */
export const RuntimeWorkflowProgressEntrySchema = /* @__PURE__ */ toLenient(WorkflowProgressEntrySchema);

export type WorkflowAgentEntry = z.infer<typeof WorkflowAgentEntrySchema>;
export type WorkflowProgressEntry = z.infer<typeof WorkflowProgressEntrySchema>;

export type AgentState = "done" | "running" | "stalled" | "error" | "stopped" | "pending";
export type PhaseStatus = "error" | "running" | "pending" | "notRun" | "done";
export type WorkflowRunStatus = "running" | "completed" | "failed" | "stopped";

export interface WorkflowProgressCounts {
	done: number;
	/** Includes stalled agents. */
	running: number;
	stalled: number;
	error: number;
	stopped: number;
	pending: number;
	total: number;
}

export interface AgentStateOptions {
	now?: number;
	stallMs?: number;
	taskStopped?: boolean;
}

export interface WorkflowPhase {
	index: number;
	title: string;
	agents: WorkflowAgentEntry[];
	counts: WorkflowProgressCounts;
	status: PhaseStatus;
	totalTokens: number;
	maxDurationMs: number | undefined;
}

export interface WorkflowProgress {
	counts: WorkflowProgressCounts;
	phases: WorkflowPhase[];
	totalTokens: number;
}

/** Upstream `le`: a running agent with no progress for longer than this is stalled. */
const DEFAULT_STALL_MS = 90_000;

/** Upstream `x`: the synthetic phase index for agents without a phase. */
export const UNPHASED_INDEX = 2 ** 53 - 1;

const ZERO_COUNTS: WorkflowProgressCounts = {
	done: 0,
	running: 0,
	stalled: 0,
	error: 0,
	stopped: 0,
	pending: 0,
	total: 0,
};

/** Upstream `de`. */
function isStarted(entry: WorkflowAgentEntry): boolean {
	return entry.state === "progress" || (entry.state === "start" && entry.startedAt !== undefined);
}

/** Upstream `fe`. */
export function agentState(entry: WorkflowAgentEntry, options?: AgentStateOptions): AgentState {
	if (entry.state === "done") return "done";
	if (options?.taskStopped) return entry.error ? "error" : "stopped";
	if (entry.state === "error") return "error";
	if (isStarted(entry)) {
		const now = options?.now;
		const stallMs = options?.stallMs ?? DEFAULT_STALL_MS;
		return now !== undefined && entry.lastProgressAt !== undefined && now - entry.lastProgressAt > stallMs
			? "stalled"
			: "running";
	}
	return "pending";
}

/** Upstream `pe`: stalled agents count as running as well. */
function tally(counts: WorkflowProgressCounts, entry: WorkflowAgentEntry, options?: AgentStateOptions): void {
	counts.total += 1;
	const state = agentState(entry, options);
	if (state === "stalled") {
		counts.running += 1;
		counts.stalled += 1;
	} else {
		counts[state] += 1;
	}
}

/** Upstream `he`. */
export function phaseStatus(counts: WorkflowProgressCounts, settled: boolean): PhaseStatus {
	if (counts.error > 0) return "error";
	if (counts.running > 0) return settled ? "done" : "running";
	if (counts.total === 0 || counts.pending === counts.total) return settled ? "notRun" : "pending";
	return counts.done === counts.total || settled ? "done" : "running";
}

/** Upstream `ge`: group entries into phases in index order. */
export function buildWorkflowProgress(
	entries: readonly WorkflowProgressEntry[] | undefined,
	options?: AgentStateOptions & {settled?: boolean},
): WorkflowProgress | undefined {
	if (!entries?.length) return undefined;
	const settled = options?.settled ?? false;
	const phases: WorkflowPhase[] = [];
	const byIndex = new Map<number, WorkflowPhase>();
	const phaseAt = (index: number, title: string | undefined): WorkflowPhase => {
		const existing = byIndex.get(index);
		if (existing) {
			if (title && existing.title.startsWith("Phase ")) existing.title = title;
			return existing;
		}
		const phase: WorkflowPhase = {
			index,
			title: title ?? `Phase ${index + 1}`,
			agents: [],
			counts: {...ZERO_COUNTS},
			status: "pending",
			totalTokens: 0,
			maxDurationMs: undefined,
		};
		byIndex.set(index, phase);
		phases.push(phase);
		return phase;
	};
	const counts = {...ZERO_COUNTS};
	let totalTokens = 0;
	for (const entry of entries) {
		if (entry.type === "workflow_phase") {
			phaseAt(entry.index, entry.title);
			continue;
		}
		const phase =
			entry.phaseIndex === undefined
				? phaseAt(UNPHASED_INDEX, undefined)
				: phaseAt(entry.phaseIndex, entry.phaseTitle);
		phase.agents.push(entry);
		tally(phase.counts, entry, options);
		tally(counts, entry, options);
		if (entry.tokens) {
			phase.totalTokens += entry.tokens;
			totalTokens += entry.tokens;
		}
		if (entry.durationMs !== undefined) {
			phase.maxDurationMs = Math.max(phase.maxDurationMs ?? 0, entry.durationMs);
		}
	}
	const unphased = byIndex.get(UNPHASED_INDEX);
	if (unphased) unphased.title = phases.length > 1 ? "Other agents" : "Agents";
	for (const phase of phases) phase.status = phaseStatus(phase.counts, settled);
	return {counts, phases: phases.toSorted((a, b) => a.index - b.index), totalTokens};
}

/**
 * Upstream `Q`: once a run has ended, its unfinished agents are failures
 * ("Workflow ended before completion", left blank when stopped). Returns the
 * input array unchanged when no agent needed ending.
 */
export function endUnfinishedAgents(
	entries: readonly WorkflowProgressEntry[],
	status: WorkflowRunStatus,
): readonly WorkflowProgressEntry[] {
	const ended = entries.map((entry): WorkflowProgressEntry => {
		if (
			entry.type !== "workflow_agent" ||
			!(isStarted(entry) || (entry.state === "start" && (entry.tokens ?? 0) > 0))
		) {
			return entry;
		}
		const error = entry.error ?? (status === "stopped" ? undefined : "Workflow ended before completion");
		const {error: _previous, ...rest} = entry;
		return error === undefined ? {...rest, state: "error"} : {...rest, state: "error", error};
	});
	return ended.some((entry, i) => entry !== entries[i]) ? ended : entries;
}

/** Upstream `Sme`/`Cme`/`xme`: cells per wrapped row, default rows, and the single-row cap. */
const CELLS_PER_ROW = 35;
const DEFAULT_MAX_ROWS = 4;
const SINGLE_ROW_CAP = 36;

/** Upstream `B$`: how many cells a grid shows before sampling proportionally. */
export function cellCap({
	wrap = false,
	maxRows = DEFAULT_MAX_ROWS,
	cols,
}: {
	wrap?: boolean;
	maxRows?: number;
	cols?: number;
}): number {
	if (cols) return UNPHASED_INDEX;
	return wrap ? CELLS_PER_ROW * maxRows : SINGLE_ROW_CAP;
}

type SampledState = "done" | "running" | "error" | "stopped" | "pending";
const SAMPLED_STATES: readonly SampledState[] = ["done", "running", "error", "stopped", "pending"];

/** Upstream `Eme`: scale counts down to `cap`, keeping one cell per non-zero state. */
function sampleCounts(counts: WorkflowProgressCounts, cap: number): Record<SampledState, number> {
	if (counts.total <= cap) {
		return {
			done: counts.done,
			running: counts.running,
			error: counts.error,
			stopped: counts.stopped,
			pending: counts.pending,
		};
	}
	const sampled: Record<SampledState, number> = {done: 0, running: 0, error: 0, stopped: 0, pending: 0};
	let used = 0;
	for (const state of SAMPLED_STATES) {
		if (counts[state] > 0 && used < cap) {
			sampled[state] = 1;
			used += 1;
		}
	}
	const remaining = cap - used;
	if (remaining > 0) {
		const shares = SAMPLED_STATES.map((state) => (counts[state] / counts.total) * remaining);
		const floors = shares.map(Math.floor);
		let assigned = floors.reduce((sum, value) => sum + value, 0);
		const byFraction = shares
			.map((share, i) => ({i, frac: share - (floors[i] ?? 0)}))
			.toSorted((a, b) => b.frac - a.frac);
		for (let k = 0; k < byFraction.length && assigned < remaining; k++) {
			const slot = byFraction[k];
			if (slot === undefined) break;
			floors[slot.i] = (floors[slot.i] ?? 0) + 1;
			assigned += 1;
		}
		SAMPLED_STATES.forEach((state, i) => {
			sampled[state] += floors[i] ?? 0;
		});
	}
	return sampled;
}

/** Upstream `Dme`: the cell states in display order. Stalled cells only show under the cap. */
export function cellStates(counts: WorkflowProgressCounts, cap: number): AgentState[] {
	const sampled = sampleCounts(counts, cap);
	const stalled = counts.total <= cap ? Math.min(counts.stalled, sampled.running) : 0;
	const runs: ReadonlyArray<readonly [AgentState, number]> = [
		["done", sampled.done],
		["running", sampled.running - stalled],
		["stalled", stalled],
		["error", sampled.error],
		["stopped", sampled.stopped],
		["pending", sampled.pending],
	];
	const cells: AgentState[] = [];
	for (const [state, n] of runs) {
		for (let i = 0; i < n; i++) cells.push(state);
	}
	return cells;
}

/** Upstream `Ome`: the agent grid's aria-label. */
export function progressSummary(counts: WorkflowProgressCounts): string {
	if (counts.total === 0) return "Waiting for agents to start";
	if (counts.stopped > 0) {
		const done = `${counts.done} of ${counts.total} ${counts.total === 1 ? "agent" : "agents"} done`;
		return `${done}, ${counts.stopped} stopped, ${counts.error} failed`;
	}
	return `${counts.done} of ${counts.total} agents done, ${counts.running - counts.stalled} running, ${counts.stalled} stalled, ${counts.error} failed`;
}

/** Upstream `kme`/`Ame`/`jme`: per-cell pulse timing so running cells don't throb in unison. */
const PULSE_BASE_S = 2.4;
const PULSE_SPREAD_S = 1.4;

export function pulseVars(index: number): {"--epitaxy-pulse-dur": string; "--epitaxy-pulse-delay": string} {
	const phase = (index * 0.618_033_988_75) % 1;
	const duration = PULSE_BASE_S + ((index * 0.754_877_666_2) % 1) * PULSE_SPREAD_S;
	return {
		"--epitaxy-pulse-dur": `${duration.toFixed(2)}s`,
		"--epitaxy-pulse-delay": `${(-phase * duration).toFixed(2)}s`,
	};
}

/** Upstream `Se`. */
const SUMMARY_PREFIX = /^(?:Dynamic w|W)orkflow ".*" (?:completed|failed|stopped|was killed)(?::\s*(.+))?\.?\s*$/s;

function capitalize(text: string): string {
	return text.length > 0 ? (text[0] ?? "").toUpperCase() + text.slice(1) : text;
}

/**
 * Upstream `we`: a task summary without the `Workflow "…" completed|failed|…:`
 * boilerplate, capitalized; undefined when it says nothing beyond the description.
 */
export function workflowSummary(summary: string | undefined, description: string | undefined): string | undefined {
	if (!summary || summary === description) return undefined;
	const match = SUMMARY_PREFIX.exec(summary);
	if (match) {
		const detail = match[1]?.trim();
		return detail ? capitalize(detail) : undefined;
	}
	return capitalize(summary);
}
