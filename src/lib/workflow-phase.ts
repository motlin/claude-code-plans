/**
 * The zod-free half of the workflow progress model (upstream c62da1b56 / c44e562e8):
 * phase bucketing constants, phase status and the phase row's aria-label. Kept apart
 * from `workflow-progress.ts` so the Subagents tree reaches it without the schemas.
 */
import type {PhaseStatus, WorkflowPhase, WorkflowProgressCounts} from "./workflow-progress";

/** Upstream `x`: the synthetic phase index for agents without a phase. */
export const UNPHASED_INDEX = 2 ** 53 - 1;

/** Upstream `he`. */
export function phaseStatus(counts: WorkflowProgressCounts, settled: boolean): PhaseStatus {
	if (counts.error > 0) return "error";
	if (counts.running > 0) return settled ? "done" : "running";
	if (counts.total === 0 || counts.pending === counts.total) return settled ? "notRun" : "pending";
	return counts.done === counts.total || settled ? "done" : "running";
}

/** Upstream `q$`: a phase's status. */
const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
	pending: "Pending",
	running: "Running",
	done: "Done",
	error: "Error",
	notRun: "Not run",
};

function agentsDone(done: number, total: number): string {
	return `${done} of ${total} ${total === 1 ? "agent" : "agents"} done`;
}

/** Upstream `$me`'s aria-label: "Phase: {title}, {status}, {done} of {total} agent(s) done". */
export function phaseAriaLabel(phase: Pick<WorkflowPhase, "index" | "title" | "counts" | "status">): string {
	const status = phase.status === "done" && phase.counts.stopped > 0 ? "Stopped" : PHASE_STATUS_LABELS[phase.status];
	const {done, total} = phase.counts;
	if (phase.index === UNPHASED_INDEX) return `${phase.title}, ${status}, ${agentsDone(done, total)}`;
	return `Phase: ${phase.title}, ${status}${total === 0 ? "" : `, ${agentsDone(done, total)}`}`;
}
