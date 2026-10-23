/**
 * claude.ai/code's `epitaxy_plan_pane_auto_open` hook (`JQ`): open the Plan pane the first time a
 * session's transcript gains todos live — after the transcript is seeded, with the same first
 * message, and with the live count growing. A session loaded with todos already present doesn't
 * trigger it, and it fires once per session (persisted).
 */
export interface PlanAutoOpenSnapshot {
	firstRecordUuid: string | undefined;
	liveCount: number;
	hasTodos: boolean;
	seeded: boolean;
}

export const INITIAL_PLAN_AUTO_OPEN_TRACK: PlanAutoOpenSnapshot = {
	firstRecordUuid: undefined,
	liveCount: 0,
	hasTodos: false,
	seeded: false,
};

export function shouldAutoOpenPlan(prev: PlanAutoOpenSnapshot, next: PlanAutoOpenSnapshot): boolean {
	const seeded = prev.seeded || next.seeded;
	const grewLive =
		seeded &&
		prev.firstRecordUuid !== undefined &&
		next.firstRecordUuid === prev.firstRecordUuid &&
		next.liveCount > prev.liveCount;
	return grewLive && !prev.hasTodos && next.hasTodos;
}

/** One run of upstream's effect: whether to open, and what it remembers for the next run. */
export function planAutoOpenStep(
	prev: PlanAutoOpenSnapshot,
	next: PlanAutoOpenSnapshot,
): {open: boolean; track: PlanAutoOpenSnapshot} {
	return {
		open: shouldAutoOpenPlan(prev, next),
		track: {
			firstRecordUuid: next.firstRecordUuid,
			liveCount: next.liveCount,
			// Upstream keeps `hadTodos` while the transcript stays non-empty.
			hasTodos: next.hasTodos || (prev.hasTodos && next.firstRecordUuid !== undefined),
			seeded: prev.seeded || next.seeded,
		},
	};
}

export const PLAN_AUTO_OPENED_STORAGE_KEY = "ccb.planAutoOpenedBySession";

function readAutoOpened(): Record<string, true> {
	try {
		const raw = localStorage.getItem(PLAN_AUTO_OPENED_STORAGE_KEY);
		if (raw === null) return {};
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		const sessions: Record<string, true> = {};
		for (const [sessionId, opened] of Object.entries(value)) if (opened === true) sessions[sessionId] = true;
		return sessions;
	} catch {
		return {};
	}
}

export function planAutoOpened(sessionId: string): boolean {
	return readAutoOpened()[sessionId] === true;
}

export function markPlanAutoOpened(sessionId: string): void {
	const sessions = readAutoOpened();
	if (sessions[sessionId] === true) return;
	sessions[sessionId] = true;
	try {
		localStorage.setItem(PLAN_AUTO_OPENED_STORAGE_KEY, JSON.stringify(sessions));
	} catch {
		// Storage unavailable: the pane may auto-open again on a later visit.
	}
}
