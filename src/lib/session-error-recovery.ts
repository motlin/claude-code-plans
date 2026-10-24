import type {ApiErrorRecovery} from "../components/api-error-card";
import type {ToastOptions} from "../components/toast-context";
import type {DeliveryResult} from "../hooks/use-composer-queue";
import {FAILURE_MESSAGE} from "../hooks/use-live-launch-options";
import type {LiveOptionChange} from "./launch-options";
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

/** The session's running model and how to switch it, for Switch model and retry. */
export interface ModelRetry {
	/** The running model's id, which the menu checks. */
	current: string | undefined;
	/** Applies the model to the pane; false when it couldn't. */
	switchTo: (model: string) => Promise<boolean>;
}

/**
 * The card's handlers through herdr: Try again types upstream's `retryNudge`
 * prompt "Try again" (any composer draft stays put, upstream `nudgeBesideDraft`),
 * Compact session types `/compact`. A not-ready agent queues the prompt like the
 * composer's send. Switch model and retry applies `/model` first and types
 * Try again only once the switch went through. Rewind opens the session's
 * rewind picker (upstream `onOpenRewindPicker`) under the same gate.
 */
export function errorRecoveryHandlers(
	availability: ErrorRecoveryAvailability,
	send: (prompt: string) => Promise<DeliveryResult>,
	enqueue: (prompt: string) => void,
	model?: ModelRetry,
	openRewindPicker?: () => void,
): ApiErrorRecovery | undefined {
	if (!availability.retryable && !availability.idle) return undefined;
	const type = async (prompt: string) => {
		const result = await send(prompt);
		if (result === "not-ready") enqueue(prompt);
	};
	return {
		...(availability.retryable && {
			onRetry: () => {
				void type("Try again");
			},
		}),
		...(availability.idle && {
			onCompact: () => {
				void type("/compact");
			},
		}),
		...(availability.retryable &&
			model !== undefined && {
				onRetryWithModel: async (next: string) => {
					if (!(await model.switchTo(next))) return false;
					await type("Try again");
					return true;
				},
			}),
		...(availability.retryable && openRewindPicker !== undefined && {onRewind: openRewindPicker}),
		...(model?.current !== undefined && {currentModel: model.current}),
	};
}

/** Applies a model to the live pane like the chin's pick, with the chin's failure toast. */
export async function switchModelForRetry(
	sessionId: string,
	model: string,
	deps: {
		send: (sessionId: string, change: LiveOptionChange) => Promise<void>;
		toast: (options: ToastOptions) => void;
	},
): Promise<boolean> {
	try {
		await deps.send(sessionId, {kind: "model", model});
		return true;
	} catch (error) {
		deps.toast({
			kind: "error",
			message: FAILURE_MESSAGE.model,
			description: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

function isTranscriptEntry(line: SessionLine): boolean {
	return line.type === "assistant" || (line.type === "user" && line.isMeta !== true);
}

/** Whether the transcript's last user or assistant entry (past system and meta records) is an API error. */
export function lastEntryIsError(lines: readonly SessionLine[]): boolean {
	const last = lines.findLast(isTranscriptEntry);
	return last?.type === "assistant" && (last.isApiErrorMessage === true || last.stopReason === "refusal");
}
