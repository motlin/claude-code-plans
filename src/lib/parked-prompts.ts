import {assertNever} from "./assert-never";
import {formatPaceBannerReset} from "./usage";

/**
 * claude.ai/code's parked messages (`cai_moonlit_dewdrop`): a prompt sent to an idle session while the
 * usage limit is spent is held in the browser instead of sent, and auto-sends once the window resets.
 * This module is the pure policy: upstream's park decision (`p2`), window ledger (`XA`/`$A`), auto-send
 * plan (`rj`), run bookkeeping (`aj` fire, `ej` settle), Stop forfeit (`nj`), skip reasons (`ij`) and copy.
 */

/** Upstream `sr`: the first auto-send waits this long past the reset. */
export const PARK_FIRE_FLOOR_MS = 90_000;
/** Upstream `mr`: a window this far past its due time never auto-sends. */
export const PARK_LATE_WINDOW_MS = 1_800_000;
/** Upstream `cr`: a second machine run waits at least this long after the first fires. */
export const PARK_RETRY_MS = 45_000;
/** Upstream's machine-run budget per window. */
export const PARK_MAX_RUNS = 3;
/** Upstream `dr`: each fire claims this slot so several sessions never fire at once. */
export const PARK_FIRE_SPACING_MS = 12_000;
/** Upstream `lr`: resets closer than this (seconds) are the same window. */
const SAME_WINDOW_SECONDS = 3600;

/** Upstream `fr`: a per-window jitter of 2–8 s. */
export function parkJitterMs(random: () => number = Math.random): number
{
	return 2000 + Math.floor(random() * 6000);
}

export type ParkDecision = "suspended" | "holds" | "flush" | "verdict" | false;

/** Upstream `p2` for a local session (always a live CLI with the opt-in on): why a send parks, or false. */
export function parkDecision({
	limit,
	heldCount,
	flushing,
	archived,
	nowMs,
}: {
	limit:
	{
		resetsAt: number;
	} | null;
	heldCount: number;
	flushing: boolean;
	archived: boolean;
	nowMs: number;
}): ParkDecision
{
	if (archived && heldCount > 0) return "suspended";
	if (heldCount > 0) return "holds";
	if (flushing) return "flush";
	if (limit !== null && limit.resetsAt * 1000 > nowMs) return "verdict";
	return false;
}

/** Upstream's per-session window ledger entry. */
export interface ParkWindow
{
	/** Epoch seconds. */
	resetsAt: number;
	busy: boolean;
	forfeit: boolean;
	clearOk: boolean;
	runs: number;
	nextRunAt: number;
	jitterMs: number;
}

/** Upstream `XA`. */
export function newParkWindow(resetsAt: number, jitterMs: number): ParkWindow
{
	return {
		resetsAt,
		busy: false,
		forfeit: false,
		clearOk: true,
		runs: 0,
		nextRunAt: 0,
		jitterMs,
	};
}

/** Upstream `$A`: a reset under an hour from the known window moves it; anything else opens a new one. */
export function windowFor(prev: ParkWindow | undefined, resetsAt: number, jitterMs: number): ParkWindow
{
	if (prev !== undefined && Math.abs(resetsAt - prev.resetsAt) < SAME_WINDOW_SECONDS)
	{
		return prev.resetsAt === resetsAt
			? prev
			:
				{
					...prev,
					resetsAt,
				};
	}
	return newParkWindow(resetsAt, jitterMs);
}

export interface HeldWindowStamp
{
	parkedForResetsAt?: number;
}

/** Upstream `ZA`: something held was parked for a window an hour or more away from this one. */
function fromEarlierWindow(held: readonly HeldWindowStamp[], resetsAt: number): boolean
{
	return held.some(
		(item) =>
			item.parkedForResetsAt !== undefined && Math.abs(resetsAt - item.parkedForResetsAt) >= SAME_WINDOW_SECONDS,
	);
}

/** Upstream `lj`: the limit is spent, known clear, or unknown. */
export type ParkVerdict = "exceeded" | "clear" | "unknown";

export interface AutoSendPlan
{
	dueAt: number;
	promisedAt: number;
	lateAfter: number;
}

/** Upstream `tj`: when the window promised to send. */
export function parkPromisedAt(window: ParkWindow, verdict: ParkVerdict, nowMs: number): number
{
	const resetMs = window.resetsAt * 1000;
	// A clear verdict well before the reset (more usage arrived) sends at once.
	if (verdict === "clear" && window.clearOk && nowMs < resetMs - PARK_FIRE_FLOOR_MS) return nowMs;
	return resetMs + PARK_FIRE_FLOOR_MS;
}

/** Upstream `rj`: when the held messages auto-send, or null when they wait for the user. */
export function autoSendPlan(
	window: ParkWindow,
	{
		nowMs,
		verdict,
		sawExceeded,
		held,
		archived,
		blocked,
	}:
	{
		nowMs: number;
		verdict: ParkVerdict;
		/** The session saw the limit exceeded; a clear verdict before that plans nothing. */
		sawExceeded: boolean;
		held: readonly HeldWindowStamp[];
		archived: boolean;
		blocked: boolean;
	},
): AutoSendPlan | null
{
	if (verdict === "clear" && !sawExceeded) return null;
	if (archived || blocked) return null;
	const promised = parkPromisedAt(window, verdict, nowMs);
	const due = promised + window.jitterMs;
	const lateAfter = due + PARK_LATE_WINDOW_MS;
	if (
		window.busy ||
		window.forfeit ||
		window.runs >= PARK_MAX_RUNS ||
		nowMs > lateAfter ||
		fromEarlierWindow(held, window.resetsAt)
	)
	{
		return null;
	}
	return {
		dueAt: Math.max(due, window.nextRunAt),
		promisedAt: promised,
		lateAfter,
	};
}

export type ParkInitiator = "machine" | "user";

/** Upstream's fire: the window goes busy, and a machine run counts and pushes the next one 45 s out. */
export function beginRun(window: ParkWindow, initiator: ParkInitiator, nowMs: number): ParkWindow
{
	return initiator === "machine"
		?
			{
				...window,
				busy: true,
				runs: window.runs + 1,
				nextRunAt: nowMs + PARK_RETRY_MS,
			}
		:
			{
				...window,
				busy: true,
			};
}

/** How a flush ended (upstream `y2`/`b2`): `halted` sent something, or tried to, and stopped early. */
export type ParkRunOutcome = "drained" | "stopped" | "untouched" | "refused" | "halted";

/** Upstream `ej`. */
export function settleRun(
	window: ParkWindow,
	initiator: ParkInitiator,
	outcome: ParkRunOutcome,
	nowMs: number,
): ParkWindow
{
	const settled =
	{
		...window,
		busy: false,
	};
	switch (outcome)
	{
		case "drained":
			settled.clearOk = true;
			return settled;
		case "stopped":
			settled.clearOk = false;
			settled.forfeit = true;
			return settled;
		case "untouched":
		case "refused":
			return settled;
		case "halted":
			if (initiator === "user")
			{
				settled.forfeit = true;
				return settled;
			}
			settled.clearOk = false;
			settled.nextRunAt = Math.max(settled.nextRunAt, nowMs + PARK_RETRY_MS);
			if (nowMs >= window.resetsAt * 1000 + PARK_FIRE_FLOOR_MS) settled.forfeit = true;
			return settled;
		default:
			return assertNever(outcome);
	}
}

/** Upstream `nj`: a Stop forfeits the window once its promised time came or a run fired. */
export function stopForfeits(
	window: ParkWindow,
	{
		nowMs,
		promisedAt: promised,
	}:
	{
		nowMs: number;
		promisedAt: number;
	},
): boolean
{
	return !window.forfeit && (nowMs >= promised || window.runs > 0);
}

export type AutoSendSkipReason = "forfeit" | "budget" | "off" | "earlier_window" | "busy" | "too_late";

/** Upstream `ij`: why a window whose late deadline passed never auto-sent its head, in upstream's order. */
export function autoSendSkipReason(
	window: ParkWindow,
	{
		headParkedAtMs,
		nowMs,
		featureOn,
		archived,
		blocked,
		turn,
		held,
	}:
	{
		headParkedAtMs: number | undefined;
		nowMs: number;
		featureOn: boolean;
		archived: boolean;
		blocked: boolean;
		turn: "idle" | "running" | "stopping";
		held: readonly HeldWindowStamp[];
	},
): AutoSendSkipReason | null
{
	const lateDeadline = window.resetsAt * 1000 + PARK_FIRE_FLOOR_MS + window.jitterMs + PARK_LATE_WINDOW_MS;
	if (headParkedAtMs === undefined || headParkedAtMs > lateDeadline || window.busy || nowMs <= lateDeadline)
		return null;
	if (window.forfeit) return "forfeit";
	if (window.runs >= PARK_MAX_RUNS) return "budget";
	if (!featureOn || archived) return "off";
	if (fromEarlierWindow(held, window.resetsAt)) return "earlier_window";
	if (blocked || turn !== "idle") return "busy";
	return "too_late";
}

/** Upstream `Bn`: the reset while it is still ahead, "Resets at 4:00 AM" today, else with its date. */
export function parkedResetDetail(resetsAt: number, nowMs: number, timeZone?: string): string | undefined
{
	if (resetsAt * 1000 < nowMs) return undefined;
	return formatPaceBannerReset(resetsAt, nowMs, timeZone);
}

/** Upstream `Hn`: the parked band's message. */
export function parkedNoticeMessage({archived, willAutoSend}: {archived: boolean; willAutoSend: boolean}): string
{
	if (archived) return "This session is archived, so held messages won’t send. Unarchive it to send them.";
	return willAutoSend
		? "You hit your usage limit. Held messages will send when it resets."
		: "You hit your usage limit. Send anyway sends held messages now.";
}

/** Upstream `Un`: the held count the limit band appends to its detail. */
export function heldCountText(count: number, willAutoSend: boolean): string
{
	if (willAutoSend) return `${count} held ${count === 1 ? "message" : "messages"} will send automatically`;
	return `${count} ${count === 1 ? "message" : "messages"} held`;
}

/** Upstream's `environmentsOn`: local has no environments, so it is always off. */
export const LOCAL_ENVIRONMENTS_ON = false;

/**
 * Upstream `ie`'s gate (and the composer store's `parkedWaiting !== null`): parked prompts list in the transcript, with
 * their count in the usage-limit band, only on the environments branch with the transcript mounted. Otherwise the dock
 * bar shows them.
 */
export function parkedListInTranscript({
	environmentsOn,
	inTranscript,
}: {
	environmentsOn: boolean;
	inTranscript: boolean;
}): boolean
{
	return environmentsOn && inTranscript;
}
