import {hmrPersist} from "./hmr-persist";
import type {PendingPlan} from "./hook-events";
import {toolInputSchemas} from "./tool-input-schemas";

/**
 * The ExitPlanMode call each session waits on, keyed by session id. The CLI
 * writes the call to the JSONL only once the plan is answered, so the hooks are
 * the only local copy while its approval dialog is open.
 */
const store = hmrPersist("pendingPlanStore", () => new Map<string, PendingPlan>());

/** Trim a hook's ExitPlanMode input to the fields the dock shows, or null when it proposes nothing. */
export function pendingPlanFromToolInput(toolUseId: string, toolInput: unknown): PendingPlan | null {
	const input = toolInputSchemas.ExitPlanMode.safeParse(toolInput);
	if (!input.success || input.data.plan === undefined || input.data.plan === "") return null;
	const pending: PendingPlan = {toolUseId, plan: input.data.plan};
	if (input.data.planFilePath !== undefined) pending.planFilePath = input.data.planFilePath;
	return pending;
}

export function setPendingPlan(sessionId: string, pending: PendingPlan): void {
	store.set(sessionId, pending);
}

/** Forget the session's pending plan; true when there was one. */
export function clearPendingPlan(sessionId: string): boolean {
	return store.delete(sessionId);
}

export function getPendingPlan(sessionId: string): PendingPlan | null {
	return store.get(sessionId) ?? null;
}

/** Forget every pending plan, as a fresh process starts. */
export function clearAllPendingPlans(): void {
	store.clear();
}
