import {useEffect, useMemo, useRef, useState} from "react";
import {
	markerEventsFromRecords,
	toolActivityLabel,
	workingMarkerState,
	type WorkingMarkerEvent,
	type WorkingMarkerState,
} from "../lib/working-marker";
import type {SessionSummaryState} from "../lib/session-state";

/**
 * Transcript turn signals overlaid with live hook state: an in-flight
 * `PreToolUse` names the activity before the JSONL flushes, and a Stop (idle)
 * or ended session closes the turn even when no `turn_duration` was written.
 */
export function useWorkingMarkerState({
	records,
	sessionState,
	isActive,
	pendingToolName,
	interruptedAt = null,
	awaitingPermission = false,
}: WorkingMarkerSignals): WorkingMarkerState {
	const events = useMemo(() => {
		const fromRecords = markerEventsFromRecords(records);
		if (interruptedAt !== null) {
			const after = fromRecords.findIndex((event) => event.at > interruptedAt);
			const index = after === -1 ? fromRecords.length : after;
			fromRecords.splice(index, 0, {kind: "interrupt", at: interruptedAt});
		}
		const lastAt = fromRecords.at(-1)?.at ?? 0;
		const overlay: WorkingMarkerEvent[] = [];
		if (pendingToolName !== undefined) {
			overlay.push({
				kind: "tool",
				at: lastAt,
				label: toolActivityLabel(pendingToolName, undefined),
			});
		}
		const hookKnown = sessionState !== null && sessionState !== "unknown";
		const closed = hookKnown ? sessionState !== "working" : !isActive;
		if (closed) overlay.push({kind: "stop", at: lastAt});
		return [...fromRecords, ...overlay];
	}, [records, sessionState, isActive, pendingToolName, interruptedAt]);
	const open = !awaitingPermission && workingMarkerState(events, 0).status !== "idle";
	const now = useNow(open);
	return useStableState(awaitingPermission ? {status: "waiting"} : workingMarkerState(events, now));
}

/** The previous state while the new one holds the same values, so what memoizes on it re-renders once per change. */
function useStableState(state: WorkingMarkerState): WorkingMarkerState {
	const previous = useRef(state);
	if (!sameState(previous.current, state)) {
		previous.current = state;
	}
	return previous.current;
}

function sameState(a: WorkingMarkerState, b: WorkingMarkerState): boolean {
	const aEntries = Object.entries(a);
	return (
		aEntries.length === Object.keys(b).length &&
		aEntries.every(([key, value]) => Object.is(value, (b as Record<string, unknown>)[key]))
	);
}

function useNow(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return undefined;
		setNow(Date.now());
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => {
			clearInterval(timer);
		};
	}, [ticking]);
	return now;
}

export interface WorkingMarkerSignals {
	records: readonly unknown[];
	/** Hook-derived main-thread state; null when no loaded session list knows it. */
	sessionState: SessionSummaryState | null;
	/** The session is running (SessionStart seen without SessionEnd). */
	isActive: boolean;
	/** The most recent `PreToolUse` still awaiting its result. */
	pendingToolName: string | undefined;
	/** When this page last sent an interrupt; it marks only the turn it was sent in. */
	interruptedAt?: number | null;
	/** The turn is blocked on a tool permission prompt, which holds it open however stale the session is. */
	awaitingPermission?: boolean;
}
