import {useEffect, useMemo, useState, useSyncExternalStore} from "react";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {
	markerEventsFromRecords,
	toolActivityLabel,
	workingMarkerState,
	workingMarkerText,
	type WorkingMarkerEvent,
	type WorkingMarkerState,
} from "../lib/working-marker";
import type {SessionSummaryState} from "../lib/session-state";
import {Spark} from "./spark";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
	if (typeof window.matchMedia !== "function") return () => {};
	const list = window.matchMedia(REDUCED_MOTION_QUERY);
	list.addEventListener("change", onChange);
	return () => list.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
	return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function usePrefersReducedMotion(): boolean {
	return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/**
 * Upstream claude.ai/code's last transcript row: a Claude spark that spins
 * while working and a footnote status line. The `role=status` region stays
 * mounted so assistive tech announces each change; it is empty when idle.
 */
export function WorkingMarker({state}: Readonly<{state: WorkingMarkerState}>) {
	const reduceMotion = usePrefersReducedMotion();
	const text = workingMarkerText(state);
	const visible = state.status !== "idle";
	return (
		<div data-perf-row="marker" className={CHAT_COLUMN_CLASS}>
			<div
				role="status"
				data-testid="response-status-announcer"
				className={visible ? "flex h-5 min-w-0 items-center gap-4" : "contents"}
			>
				{visible && (
					<>
						<Spark size={16} animated={state.status !== "stopping" && !reduceMotion} />
						<span
							title={text}
							className={`min-w-0 truncate whitespace-nowrap text-footnote text-secondary tabular-nums${
								state.status === "stopping" ? " working-marker-shimmer" : ""
							}`}
						>
							{text}
						</span>
					</>
				)}
			</div>
		</div>
	);
}

function useNow(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
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
}

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
	const open = workingMarkerState(events, 0).status !== "idle";
	const now = useNow(open);
	return workingMarkerState(events, now);
}
