import {useSyncExternalStore} from "react";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {workingMarkerText, type WorkingMarkerState} from "../lib/working-marker";
import {RunningTasksControl} from "./running-tasks-control";
import {Spark} from "./spark";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
	if (typeof window.matchMedia !== "function") return () => {};
	const list = window.matchMedia(REDUCED_MOTION_QUERY);
	list.addEventListener("change", onChange);
	return () => {
		list.removeEventListener("change", onChange);
	};
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
 * The running background task count rides in the line only while it shows.
 */
export function WorkingMarker({state, runningTasks = 0}: Readonly<{state: WorkingMarkerState; runningTasks?: number}>) {
	const reduceMotion = usePrefersReducedMotion();
	const text = workingMarkerText(state);
	// Upstream draws no spark while the turn waits on the user.
	const visible = state.status !== "idle" && state.status !== "waiting";
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
						<RunningTasksControl count={runningTasks} />
					</>
				)}
			</div>
		</div>
	);
}
