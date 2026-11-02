/**
 * What a plan card held when its answer was sent, keyed by
 * `${sessionId}:${toolUseId}` (upstream's `unsentFeedback`). An answered card
 * unmounts at the click, so a refused answer brings its card back from here:
 * the Revise box open or not, the typed feedback and the refusal.
 */
export interface UnsentPlan
{
	revising: boolean;
	feedback: string;
	error: string | null;
}

const unsent = new Map<string, UnsentPlan>();

function unsentKey(sessionId: string, toolUseId: string): string
{
	return `${sessionId}:${toolUseId}`;
}

export function setUnsentPlan(sessionId: string, toolUseId: string, plan: UnsentPlan): void
{
	unsent.set(unsentKey(sessionId, toolUseId), plan);
}

export function getUnsentPlan(sessionId: string, toolUseId: string): UnsentPlan | null
{
	return unsent.get(unsentKey(sessionId, toolUseId)) ?? null;
}

export function clearUnsentPlan(sessionId: string, toolUseId: string): void
{
	unsent.delete(unsentKey(sessionId, toolUseId));
}
