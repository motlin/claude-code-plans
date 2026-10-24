import type {ApiErrorRecovery} from "../components/api-error-card";
import type {DeliveryResult} from "../hooks/use-composer-queue";
import type {SessionLine} from "./transcript";
import type {WorkingMarkerState} from "./working-marker";

/** What decides whether the last API error card can act on the live session. */
export interface ErrorRecoveryGate {
	hasLivePane: boolean;
	writesEnabled: boolean;
	paneStatus: WorkingMarkerState["status"];
	/** A pending question, permission or plan card would swallow a typed prompt. */
	pendingCard: boolean;
	/** A live prompt send is still in flight. */
	isPending: boolean;
	/** The error is the transcript's last entry. */
	isLastEntry: boolean;
}

/** Upstream `ph`: `retryable` gates Try again, `idle` gates Compact session. */
export interface ErrorRecoveryAvailability {
	retryable: boolean;
	idle: boolean;
}

/**
 * The local `retryable`/`idle`: upstream's not-responding, not-read-only, which
 * for a herdr pane means live, writable, idle, with no dialog open and nothing
 * mid-send. Upstream's attachment lock has no local analogue, so both agree.
 */
export function errorRecoveryAvailability(gate: ErrorRecoveryGate): ErrorRecoveryAvailability {
	const open =
		gate.hasLivePane &&
		gate.writesEnabled &&
		gate.paneStatus === "idle" &&
		!gate.pendingCard &&
		!gate.isPending &&
		gate.isLastEntry;
	return {retryable: open, idle: open};
}

/**
 * The card's handlers through herdr: Try again types upstream's `retryNudge`
 * prompt "Try again" (any composer draft stays put, upstream `nudgeBesideDraft`),
 * Compact session types `/compact`. A not-ready agent queues the prompt like the
 * composer's send.
 */
export function errorRecoveryHandlers(
	availability: ErrorRecoveryAvailability,
	send: (prompt: string) => Promise<DeliveryResult>,
	enqueue: (prompt: string) => void,
): ApiErrorRecovery | undefined {
	if (!availability.retryable && !availability.idle) return undefined;
	const type = (prompt: string) => () => {
		void send(prompt).then((result) => {
			if (result === "not-ready") enqueue(prompt);
		});
	};
	return {
		...(availability.retryable && {onRetry: type("Try again")}),
		...(availability.idle && {onCompact: type("/compact")}),
	};
}

function isTranscriptEntry(line: SessionLine): boolean {
	return line.type === "assistant" || (line.type === "user" && line.isMeta !== true);
}

/** Whether the transcript's last user or assistant entry (past system and meta records) is an API error. */
export function lastEntryIsError(lines: readonly SessionLine[]): boolean {
	const last = lines.findLast(isTranscriptEntry);
	return last?.type === "assistant" && (last.isApiErrorMessage === true || last.stopReason === "refusal");
}
