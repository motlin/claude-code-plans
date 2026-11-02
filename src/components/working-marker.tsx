import {Fragment, useEffect, useState, useSyncExternalStore} from "react";
import {useEventStreamConnecting} from "../hooks/use-claude-events";
import {useRestInk} from "../lib/fizzy-lake";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {
	CONNECTING_PHASE_LABEL,
	PHASE_SETTLE_MS,
	phaseLabel,
	stripTrailingEllipsis,
	workingLineAnnouncement,
	workingLineParts,
	workingMarkerText,
	type WorkingMarkerState,
} from "../lib/working-marker";
import {RunningTasksControl} from "./running-tasks-control";
import {ShimmerText} from "./shimmer-text";
import {workingLineActivity} from "../lib/working-mark-activity";
import {WorkingMark} from "./working-mark";

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

/** Upstream swaps the Stopping label in with a short rise-and-fade. */
const STOPPING_MORPH_CLASS = "motion-safe:animate-[cds-morph-in_0.18s_cubic-bezier(.2,0,0,1)]";

const NEEDS_INPUT_LABEL = "Needs your input";

/** Upstream's warning Badge (`fX variant="warning"`) in the blocked TurnStatus. */
const WARNING_BADGE_CLASS =
	"inline-flex h-5 min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 align-middle font-sans text-caption font-medium bg-[var(--warning-tint)] text-upstream-warning";

function BlockedStatus({reduceMotion}: Readonly<{reduceMotion: boolean}>) {
	return (
		<div
			data-cds="TurnStatus"
			data-state="blocked"
			title={NEEDS_INPUT_LABEL}
			className="group/status flex w-full min-w-0 flex-col"
		>
			<div className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-body comfortable:px-1.5 comfortable:py-1.5">
				<span
					data-cds-row-mark
					aria-hidden
					className="relative me-[6px] flex h-[1lh] w-[20px] shrink-0 items-center justify-center"
				>
					<WorkingMark activity="blocked" animated={!reduceMotion} />
				</span>
				<span className="inline-flex h-[1lh] min-w-0 items-center">
					<span data-cds="Badge" className={WARNING_BADGE_CLASS}>
						<span className="min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap pb-[0.05em]">
							<bdi>{NEEDS_INPUT_LABEL}</bdi>
						</span>
					</span>
				</span>
			</div>
		</div>
	);
}

/** Upstream's `g8`: a phase word appears or clears at once, but swapping for another waits out the settle. */
function useSettledPhase(target: string | null): string | null {
	const [shown, setShown] = useState(target);
	const immediate = target === null || shown === null;
	if (immediate && shown !== target) setShown(target);
	useEffect(() => {
		if (target === shown || target === null || shown === null) return undefined;
		const timer = setTimeout(() => {
			setShown(target);
		}, PHASE_SETTLE_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [target, shown]);
	return immediate ? target : shown;
}

function waitingPhase(state: WorkingMarkerState, sending: boolean): string | null {
	if (state.status === "working") return phaseLabel({sending, promptSeen: true, firstAssistantSeen: state.replied});
	if (state.status === "idle") return phaseLabel({sending, promptSeen: false, firstAssistantSeen: false});
	return null;
}

/** Upstream's `le`: while the stream is (re)connecting, an active waiting phase reads "Connecting…". */
function useLinePhase(state: WorkingMarkerState, sending: boolean, waitingOnUser: boolean): string | null {
	const phase = waitingOnUser ? null : waitingPhase(state, sending);
	const streamConnecting = useEventStreamConnecting(phase !== null);
	return streamConnecting ? CONNECTING_PHASE_LABEL : phase;
}

/**
 * Upstream's busy phase label: the bare word as ShimmerText in a `group/morph` slot keyed
 * `busy|<word>`, so a later morph can swap it.
 */
function PhaseWord({word}: Readonly<{word: string}>) {
	return (
		<span className="group/morph inline-grid items-center justify-items-start min-w-0 max-w-full">
			<span
				data-morph-key={`busy|${word}`}
				className="col-start-1 row-start-1 flex min-w-0 max-w-full items-center"
			>
				<ShimmerText className="min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em]">
					{word}
				</ShimmerText>
			</span>
		</span>
	);
}

function StatDot() {
	return (
		<span aria-hidden className={`shrink-0 select-none ${useRestInk()} tabular-nums`}>
			·
		</span>
	);
}

/**
 * Upstream claude.ai/code's working line (`code-working-line`): a TurnStatus
 * row of the working mark and muted "·"-joined stats, with no visible
 * "Working…" label. It stays mounted at 24px whether busy, quiet (a tool row
 * is in flight) or done, so the transcript bottom never jumps; a polite
 * sr-only status announces "Working…" instead of the ticking clock. While a
 * prompt waits on the user with no inline card, it says "Needs your input".
 * Before Claude replies, a phase word ("Sending…", "Waiting for Claude…")
 * stands in for the stats.
 */
export function WorkingMarker({
	state,
	runningTasks = 0,
	quiet = false,
	waitingOnUser = false,
	inline = false,
	sending = false,
	tokens = 0,
}: Readonly<{
	state: WorkingMarkerState;
	runningTasks?: number;
	quiet?: boolean;
	waitingOnUser?: boolean;
	/** Nested under the last assistant reply, as upstream's `ps-[inset] -mt-pad-xs` wrapper, not in its own column. */
	inline?: boolean;
	/** A prompt sent to the live pane has not reached the transcript yet. */
	sending?: boolean;
	/** The turn's token estimate (`turnTokenEstimate`); shown after the clock while working. */
	tokens?: number;
}>) {
	const reduceMotion = usePrefersReducedMotion();
	const restInk = useRestInk();
	const phase = useSettledPhase(useLinePhase(state, sending, waitingOnUser));
	// Upstream draws no mark while the turn waits on the user.
	const turnWorking = !waitingOnUser && (phase !== null || (state.status !== "idle" && state.status !== "waiting"));
	const busy = turnWorking && !quiet;
	const parts = workingLineParts(state, tokens);
	const phaseWord = phase === null ? null : stripTrailingEllipsis(phase);
	const label = phaseWord ?? parts.label;
	const stats = phase === null ? parts.stats : [];
	const tasks = runningTasks > 0;
	const line = (
		<div
			data-testid="code-working-line"
			data-turn-working={turnWorking ? "true" : "false"}
			{...(quiet && turnWorking ? {"data-quiet": "true", "aria-hidden": true} : {})}
			className={`${quiet && turnWorking ? "invisible " : ""}flex min-h-6 flex-col comfortable:min-h-8`}
		>
			{waitingOnUser && <BlockedStatus reduceMotion={reduceMotion} />}
			{busy && (
				<div data-cds="TurnStatus" data-state="busy" className="group/status flex w-full min-w-0 flex-col">
					<div
						{...(phase === null ? {} : {title: phase})}
						className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-body comfortable:px-1.5 comfortable:py-1.5"
					>
						<span
							data-cds-row-mark
							aria-hidden
							className="relative me-[6px] flex h-[1lh] w-[20px] shrink-0 items-center justify-center"
						>
							<WorkingMark
								activity={workingLineActivity(state.status === "working" && state.thinking)}
								animated={!reduceMotion}
							/>
						</span>
						<span className="inline-flex min-w-0 items-center text-secondary">
							{phaseWord !== null && <PhaseWord word={phaseWord} />}
							{phaseWord === null && label !== "" && (
								<span
									title={workingMarkerText(state, tokens)}
									className={`truncate whitespace-nowrap${
										state.status === "stopping" ? ` ${STOPPING_MORPH_CLASS}` : ""
									}`}
								>
									{state.status === "stopping" ? <ShimmerText>{label}</ShimmerText> : label}
								</span>
							)}
						</span>
						{stats.map((stat, index) => (
							<Fragment key={stat}>
								{(index > 0 || label !== "") && <StatDot />}
								<span className={`inline-flex h-[1lh] shrink-0 items-center ${restInk} tabular-nums`}>
									{stat}
								</span>
							</Fragment>
						))}
						{tasks && (label !== "" || stats.length > 0) && <StatDot />}
						<RunningTasksControl count={runningTasks} />
						<span className="sr-only">running</span>
					</div>
				</div>
			)}
			<span role="status" aria-live="polite" className="sr-only">
				{waitingOnUser ? NEEDS_INPUT_LABEL : (phaseWord ?? workingLineAnnouncement(state))}
			</span>
		</div>
	);
	return inline ? (
		<div data-perf-row="marker" className="-mt-1">
			{line}
		</div>
	) : (
		<div data-perf-row="marker" className={CHAT_COLUMN_CLASS}>
			{line}
		</div>
	);
}
