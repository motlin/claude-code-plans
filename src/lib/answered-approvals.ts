import {useSyncExternalStore} from "react";

/**
 * Upstream's answered set (shared-39 `Ty`/`s9`/`xr`): approvals answered in
 * this tab, keyed by `${sessionId}:${toolUseId}`. A decision marks its tool
 * call before the answer is sent, and every view treats a marked prompt as
 * consumed, so a signal handoff that redescribes the same call can't redraw
 * it. A failed answer clears the mark and the prompt comes back.
 */
const answered = new Set<string>();

const listeners = new Set<() => void>();

/** Bumped on every mark and clear, like upstream's `u3` counter. */
let version = 0;

function answerKey(sessionId: string, id: string): string {
	return `${sessionId}:${id}`;
}

function notify(): void {
	version += 1;
	for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function markApprovalAnswered(sessionId: string, id: string): void {
	answered.add(answerKey(sessionId, id));
	notify();
}

export function clearApprovalAnswered(sessionId: string, id: string): void {
	answered.delete(answerKey(sessionId, id));
	notify();
}

export function isApprovalAnswered(sessionId: string, id: string): boolean {
	return answered.has(answerKey(sessionId, id));
}

/** Upstream's `YS`: re-renders whenever any approval is marked or cleared. */
function useAnsweredApprovalsVersion(): number {
	return useSyncExternalStore(
		subscribe,
		() => version,
		() => 0,
	);
}

/** Whether this tab answered the session's approval `id`; a null id never is. */
export function useApprovalAnswered(sessionId: string, id: string | null): boolean {
	useAnsweredApprovalsVersion();
	return id !== null && isApprovalAnswered(sessionId, id);
}
