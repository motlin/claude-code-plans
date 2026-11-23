import {Fragment, useEffect, useId, useMemo, useState} from "react";
import {useSmoothedTokens} from "../hooks/use-smoothed-tokens";
import {useEventStreamConnecting} from "../hooks/use-claude-events";
import {useRestInk} from "../lib/fizzy-lake";
import {useReducedMotion} from "../lib/reduced-motion";
import {useRowCut} from "../lib/use-row-cut";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import
{
	clockHidden,
	ELAPSED_MIN_SECONDS,
	maskWorkingLabel,
	CONNECTING_PHASE_LABEL,
	PHASE_SETTLE_MS,
	phaseLabel,
	stripBusyEllipsis,
	turnStatusSwapKey,
	toolLabelStats,
	workingLineAnnouncement,
	workingLineLabelSource,
	workingLineParts,
	workingMarkerText,
	workingStatKey,
	type WorkingLineToolLabel,
	type WorkingMarkerState,
} from "../lib/working-marker";
import {MorphSlot} from "./ui/morph-slot";
import {useHeldLabel} from "../hooks/use-held-label";
import {turnStatusHoldOptions} from "../lib/turn-status-hold";
import {RunningTasksControl} from "./running-tasks-control";
import {ShimmerText} from "./shimmer-text";
import {workingLineActivity} from "../lib/working-mark-activity";
import {WorkingMark} from "./working-mark";
import {TurnStatusMarkSlot} from "./turn-status-mark-slot";
import
{
	TURN_STATUS_ROW_GEOMETRY,
	TURN_STATUS_ROW_MARKED_MOTION,
	TURN_STATUS_ROW_PAD_Y,
	TURN_STATUS_ROW_STYLE,
} from "./turn-status-row-geometry";

const NEEDS_INPUT_LABEL = "Needs your input";

/** Upstream `gR` for the marked busy/blocked row: sD, items-center, gr, qe, the margin ease and the inset focus ring. */
const WORKING_ROW_CLASS = `flex min-w-0 gap-xs text-start font-sans text-body font-normal items-center ${TURN_STATUS_ROW_PAD_Y} ${TURN_STATUS_ROW_GEOMETRY} ${TURN_STATUS_ROW_MARKED_MOTION} rounded outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--cds-fill-accent)] focus-visible:outline-hidden`;

/** Upstream `q6`'s `Dg(word, 650, …, epoch)`: a shown phase word holds this long before it changes. */
const PHASE_WORD_HOLD_MS = 650;

/** Upstream's warning Badge (`fX variant="warning"`) in the blocked TurnStatus. */
const WARNING_BADGE_CLASS =
	"inline-flex h-5 min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 align-middle font-sans text-caption font-medium bg-[var(--warning-tint)] text-upstream-warning";

function BlockedStatus({
	reduceMotion,
}: Readonly<
{
	reduceMotion: boolean;
}>)
{
	return (
		<div
			data-cds="TurnStatus"
			data-state="blocked"
			title={NEEDS_INPUT_LABEL}
			className="group/status flex w-full min-w-0 flex-col"
		>
			<div tabIndex={-1} className={WORKING_ROW_CLASS} style={TURN_STATUS_ROW_STYLE}>
				<TurnStatusMarkSlot motion="busy">
					<WorkingMark activity="blocked" animated={!reduceMotion} />
				</TurnStatusMarkSlot>
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

/** What the working line's busy row shows, held as one value like upstream's TurnStatus row. */
interface HeldLine
{
	state: "busy" | "done";
	morphWord: string | null;
	label: string;
	stats: readonly string[];
	rowTitle: string | undefined;
	announcement: string;
}

/**
 * Upstream's `q6`: the phase word the line shows. While `holdPrevious`, a cleared word keeps the shown one; a word
 * appears or clears at once (and so does any change as a turn starts working), but swapping for another waits out the
 * settle. The result then passes `Dg`: a shown word holds 650ms before any change, unless a new turn starts.
 */
function usePhaseWord(target: string | null, holdPrevious: boolean, working: boolean): string | null
{
	const [run, setRun] = useState(
		{
			working,
			epoch: 0,
		},
	);
	const started = working && !run.working;
	const epoch = started ? run.epoch + 1 : run.epoch;
	if (working !== run.working)
		setRun(
			{
				working,
				epoch,
			},
		);
	const [shown, setShown] = useState(target);
	const next = target === null && holdPrevious ? shown : target;
	const immediate = next !== shown && (started || next === null || shown === null);
	if (immediate) setShown(next);
	useEffect(() =>
	{
		if (next === shown || next === null || shown === null) return undefined;
		const timer = setTimeout(() =>
		{
			setShown(next);
		}, PHASE_SETTLE_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [next, shown]);
	const settled = immediate ? next : shown;
	const value = useMemo(
		() => (
		{
			word: settled,
			epoch,
		}),
		[settled, epoch],
	);
	const held = useHeldLabel(
		value,
		`${String(epoch)}|${settled ?? ""}`,
		{
			minMs: (current) => (current.epoch === epoch ? PHASE_WORD_HOLD_MS : 0),
		},
	);
	return held.word;
}

function waitingPhase(state: WorkingMarkerState, sending: boolean): string | null
{
	if (state.status === "working")
		return phaseLabel(
			{
				sending,
				promptSeen: true,
				firstAssistantSeen: state.replied,
			},
		);
	if (state.status === "idle")
		return phaseLabel(
			{
				sending,
				promptSeen: false,
				firstAssistantSeen: false,
			},
		);
	return null;
}

/** Upstream's `le`: while the stream is (re)connecting, an active waiting phase reads "Connecting…". */
function useLinePhase(state: WorkingMarkerState, sending: boolean, waitingOnUser: boolean): string | null
{
	const phase = waitingOnUser ? null : waitingPhase(state, sending);
	const streamConnecting = useEventStreamConnecting(phase !== null);
	return streamConnecting ? CONNECTING_PHASE_LABEL : phase;
}

/** Upstream's `y_`: a busy text label's single-line ShimmerText. */
const BUSY_LABEL_CLASS = "min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em]";

/** Upstream's busy text label: the bare word as ShimmerText, cut at the row's end. */
function BusyWord({
	word,
}: Readonly<
{
	word: string;
}>)
{
	const rowCut = useRowCut(true, word);
	return (
		<ShimmerText ref={rowCut} variant="secondary" className={BUSY_LABEL_CLASS}>
			{word}
		</ShimmerText>
	);
}

function StatDot()
{
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
 * is in flight) or done, so the transcript bottom never jumps; while the turn
 * works, a polite sr-only status announces "Working…" instead of the ticking
 * clock. While a
 * prompt waits on the user with no inline card, it says "Needs your input".
 * Before Claude replies, a phase word ("Sending…", "Waiting for Claude…")
 * stands in for the stats.
 */
export function WorkingMarker({
	state,
	runningTasks = 0,
	quiet = false,
	waitingOnUser = false,
	empty = false,
	inline = false,
	bare = false,
	sending = false,
	tokens = 0,
	tokenFirstAt,
	sessionKey,
	toolLabel = null,
	toolLabelEndedAt = null,
}: Readonly<
{
	state: WorkingMarkerState;
	runningTasks?: number;
	quiet?: boolean;
	waitingOnUser?: boolean;
	/** Upstream's line under a plan-exit card: mounted, not working, with no status or placeholder inside. */
	empty?: boolean;
	/** Nested under the last assistant reply, as upstream's `ps-[inset] -mt-pad-xs` wrapper, not in its own column. */
	inline?: boolean;
	/** A child of upstream's tail-chrome grid (`si`), which places the line itself, so no column wrapper. */
	bare?: boolean;
	/** A prompt sent to the live pane has not reached the transcript yet. */
	sending?: boolean;
	/** The turn's token estimate (`turnTokenEstimate`); shown after the clock while working. */
	tokens?: number;
	/** When the turn's count first turned positive (`turnFirstTokenAt`); a count under 5s old ramps up from 0. */
	tokenFirstAt?: number | undefined;
	/** The session shown; a new one restarts the token smoother. */
	sessionKey?: string;
	/** A row's running words handed to the line while it holds the mark (upstream's `toolLabel`). */
	toolLabel?: WorkingLineToolLabel | null;
	/** When the last handed-off words cleared; the clock stays hidden for 2s after. */
	toolLabelEndedAt?: number | null;
}>)
{
	const reduceMotion = useReducedMotion();
	const restInk = useRestInk();
	const linePhase = useLinePhase(state, sending, waitingOnUser);
	// Upstream draws no mark while the turn waits on the user.
	const turnWorking =
		!empty && !waitingOnUser && (linePhase !== null || (state.status !== "idle" && state.status !== "waiting"));
	// Upstream keeps the last phase word until the token stat or Thinking has something to say.
	const holdPhase =
		state.status === "working" &&
		!waitingOnUser &&
		!state.thinking &&
		!(state.elapsedSeconds >= ELAPSED_MIN_SECONDS && tokens > 0);
	const phase = usePhaseWord(linePhase, holdPhase, turnWorking);
	const source = workingLineLabelSource(
		{
			state,
			phase,
			toolLabel,
		},
	);
	const tool = source === "tool" && state.status === "working" ? toolLabel : null;
	// Holding a row's words, the line holds the mark itself and is never quiet.
	const lineQuiet = quiet && tool === null;
	const busy = turnWorking && !lineQuiet;
	// Upstream's `isRunning: isActuallyWorking && !quiet`: a quiet line's count snaps instead of ticking.
	const shownTokens = useSmoothedTokens(
		{
			sessionKey,
			tokens,
			running: busy && state.status === "working",
			firstPositiveAt: tokenFirstAt,
		},
	);
	const now = "turnStartedAt" in state ? state.turnStartedAt + state.elapsedSeconds * 1000 : null;
	const showClock =
		now === null ||
		!clockHidden(
			{
				now,
				endedAt: toolLabelEndedAt,
			},
		);
	const parts = workingLineParts(state, shownTokens, showClock);
	const phaseWord = phase === null ? null : stripBusyEllipsis(phase);
	const toolWords = tool === null ? null : maskWorkingLabel(tool.words);
	const toolWord = toolWords === null ? null : stripBusyEllipsis(toolWords);
	// Upstream's busy text labels: a phase word, a row's handed-off words, or Stopping.
	const morphWord = phaseWord ?? toolWord ?? (state.status === "stopping" ? parts.label : null);
	const label = morphWord ?? parts.label;
	const stats =
		phase === null
			? tool !== null && state.status === "working"
				? toolLabelStats(state, tool.since, shownTokens)
				: parts.stats
			: [];
	const live: HeldLine =
	{
		state: busy ? "busy" : "done",
		morphWord,
		label,
		stats,
		rowTitle: phase ?? toolWords ?? undefined,
		announcement: phaseWord ?? (tool?.unspoken === true ? (toolWord ?? "") : workingLineAnnouncement(state)),
	};
	// Upstream's working line is a leaf TurnStatus row (`QCe` → gR), so every busy → busy label change waits
	// the 250ms settle and then 650ms after the shown label; going idle swaps at once.
	const held = useHeldLabel(
		live,
		busy ? turnStatusSwapKey("busy", morphWord ?? undefined) : turnStatusSwapKey("done", null),
		turnStatusHoldOptions(live.state, true, undefined),
	);
	const tasks = runningTasks > 0;
	const labelRowCut = useRowCut(true, held.morphWord === null ? held.label : "");
	const labelId = `${useId()}-label`;
	const line = (
		<div
			data-testid="code-working-line"
			data-turn-working={turnWorking ? "true" : "false"}
			{...(lineQuiet && turnWorking
				?
					{
						"data-quiet": "true",
						"aria-hidden": true,
					}
				: {})}
			className={`${lineQuiet && turnWorking ? "invisible " : ""}flex min-h-control flex-col`}
		>
			{waitingOnUser && <BlockedStatus reduceMotion={reduceMotion} />}
			{held.state === "busy" && (
				<div data-cds="TurnStatus" data-state="busy" className="group/status flex w-full min-w-0 flex-col">
					<div
						{...(held.rowTitle === undefined
							? {}
							:
								{
									title: held.rowTitle,
								})}
						data-cds-row=""
						tabIndex={-1}
						className={WORKING_ROW_CLASS}
						style={TURN_STATUS_ROW_STYLE}
					>
						<TurnStatusMarkSlot motion="busy">
							<WorkingMark
								activity={workingLineActivity(
									state.status === "working" && state.thinking && tool === null,
								)}
								animated={!reduceMotion}
							/>
						</TurnStatusMarkSlot>
						<MorphSlot
							id={labelId}
							swapKey={turnStatusSwapKey("busy", held.morphWord ?? undefined)}
							className="min-w-0 max-w-full"
						>
							{held.morphWord === null ? (
								<span className="inline-flex min-w-0 items-center text-secondary">
									{held.label !== "" && (
										<span
											ref={labelRowCut}
											title={workingMarkerText(state, shownTokens)}
											className="truncate whitespace-nowrap"
										>
											{held.label}
										</span>
									)}
								</span>
							) : (
								<BusyWord word={held.morphWord} />
							)}
						</MorphSlot>
						{held.stats.map((stat, index) =>
						{
							const key = workingStatKey(stat);
							return (
								<Fragment key={key}>
									{(index > 0 || held.label !== "") && <StatDot />}
									<span
										className={`inline-flex h-[1lh] min-w-0 shrink-0 items-center overflow-visible ${restInk} tabular-nums`}
									>
										{key === "tokens" ? (
											<span className="epitaxy-status-control inline-flex min-w-0 items-center gap-xs">
												{stat}
											</span>
										) : (
											stat
										)}
									</span>
								</Fragment>
							);
						})}
						{tasks && (held.label !== "" || held.stats.length > 0) && <StatDot />}
						<RunningTasksControl count={runningTasks} />
						<span className="sr-only">running</span>
					</div>
				</div>
			)}
			{turnWorking || waitingOnUser ? (
				<span role="status" aria-live="polite" className="sr-only">
					{waitingOnUser ? NEEDS_INPUT_LABEL : held.announcement}
				</span>
			) : (
				// Upstream's done line holds one control-height placeholder and drops its status; the empty line holds none.
				!empty && (
					<div className="flex items-center h-control ps-[var(--cds-assistant-message-text-inset,0px)]" />
				)
			)}
		</div>
	);
	if (bare) return line;
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
