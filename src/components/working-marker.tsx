import {Fragment, useSyncExternalStore} from "react";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {
	workingLineAnnouncement,
	workingLineParts,
	workingMarkerText,
	type WorkingMarkerState,
} from "../lib/working-marker";
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

const STAT_CLASS = "inline-flex h-[1lh] shrink-0 items-center text-ink-muted tabular-nums";

function StatDot() {
	return (
		<span aria-hidden className="shrink-0 select-none text-ink-muted tabular-nums">
			·
		</span>
	);
}

/**
 * Upstream claude.ai/code's working line (`code-working-line`): a TurnStatus
 * row of the working mark and muted "·"-joined stats, with no visible
 * "Working…" label. It stays mounted at 24px whether busy, quiet (a tool row
 * is in flight) or done, so the transcript bottom never jumps; a polite
 * sr-only status announces "Working…" instead of the ticking clock.
 */
export function WorkingMarker({
	state,
	runningTasks = 0,
	quiet = false,
}: Readonly<{state: WorkingMarkerState; runningTasks?: number; quiet?: boolean}>) {
	const reduceMotion = usePrefersReducedMotion();
	// Upstream draws no mark while the turn waits on the user.
	const turnWorking = state.status !== "idle" && state.status !== "waiting";
	const busy = turnWorking && !quiet;
	const {label, stats} = workingLineParts(state);
	const tasks = runningTasks > 0;
	return (
		<div data-perf-row="marker" className={CHAT_COLUMN_CLASS}>
			<div
				data-testid="code-working-line"
				data-turn-working={turnWorking ? "true" : "false"}
				{...(quiet && turnWorking ? {"data-quiet": "true", "aria-hidden": true} : {})}
				className={`${quiet && turnWorking ? "invisible " : ""}flex min-h-6 flex-col`}
			>
				{busy && (
					<div data-cds="TurnStatus" data-state="busy" className="group/status flex w-full min-w-0 flex-col">
						<div className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-body">
							<span
								data-cds-row-mark
								aria-hidden
								className="relative me-[6px] flex h-[1lh] w-[20px] shrink-0 items-center justify-center"
							>
								<Spark size={20} animated={state.status !== "stopping" && !reduceMotion} />
							</span>
							<span className="inline-flex min-w-0 items-center text-secondary">
								{label !== "" && (
									<span
										title={workingMarkerText(state)}
										className={`truncate whitespace-nowrap${
											state.status === "stopping" ? " working-marker-shimmer" : ""
										}`}
									>
										{label}
									</span>
								)}
							</span>
							{stats.map((stat, index) => (
								<Fragment key={stat}>
									{(index > 0 || label !== "") && <StatDot />}
									<span className={STAT_CLASS}>{stat}</span>
								</Fragment>
							))}
							{tasks && (label !== "" || stats.length > 0) && <StatDot />}
							<RunningTasksControl count={runningTasks} />
							<span className="sr-only">running</span>
						</div>
					</div>
				)}
				<span role="status" aria-live="polite" className="sr-only">
					{workingLineAnnouncement(state)}
				</span>
			</div>
		</div>
	);
}
