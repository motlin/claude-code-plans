import {useEffect, useRef, useState, useSyncExternalStore} from "react";

import
{
	AUTO_RESUME_STALE_S,
	type AutoResumeEntry,
	afterFire,
	fireAtSeconds,
	getAutoResumeEntry,
	liveEntry,
	offerEntry,
	readOptInPref,
	setAutoResumeEntry,
	subscribeAutoResume,
	supersede,
} from "../lib/limit-auto-resume";
import {type ParkDecision, parkJitterMs} from "../lib/parked-prompts";
import {lastEntryError} from "../lib/session-error-recovery";
import type {MessageSessionLine, SessionLine} from "../lib/transcript";
import {isUsageLimitText} from "../lib/usage-limit-notice";
import type {DeliveryResult} from "./use-composer-queue";

/** Upstream's after-usage-limit nudge (intl UqWMzb). */
export const AUTO_RESUME_NUDGE =
	"I hit my usage limit while you were working, but it has reset now. Please continue from where you left off.";
/** Upstream's sr announcement when the nudge goes out (intl PZ1vuM). */
const RESUMING_ANNOUNCEMENT = "Limits reset — resuming session";
/** Upstream's live-region swap: the text lands this long after the region is cleared, so it is re-read. */
const ANNOUNCE_DELAY_MS = 50;
/** Upstream `jn`: a later attempt whose reset has passed waits at least this long. */
const RETRY_FLOOR_MS = 45_000;
/** Upstream `zn`: the wake-aware timer never sleeps longer than this before re-checking the clock. */
const MAX_SLEEP_MS = 30_000;

/** The session's auto-resume entry, re-rendering as the store changes. */
export function useAutoResumeEntry(sessionId: string): AutoResumeEntry | undefined
{
	return useSyncExternalStore(
		subscribeAutoResume,
		() => getAutoResumeEntry(sessionId),
		() => undefined,
	);
}

export interface LimitAutoResumeOptions
{
	sessionId: string;
	lines: readonly SessionLine[];
	/** The live session can take a typed prompt now (the last error card's Try again gate). */
	retryable: boolean;
	/** The live pane send. A limit-continue send is never parked, so it skips the composer's park gate. */
	send: (prompt: string) => Promise<DeliveryResult>;
	/** The composer's draft, or null when no composer is mounted. */
	composerText: () => string | null;
	/** Upstream `U_`: held or parked messages decline the fire. */
	parked: () => ParkDecision;
	random?: () => number;
}

interface LimitError
{
	key: string;
	/** Undefined for a limit text without the record's window, which upstream can't schedule. */
	limit?:
	{
		resetsAt: number;
		rateLimitType: string;
	};
	isRateLimit: boolean;
}

function lineText(line: MessageSessionLine): string
{
	const content = line.message?.content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** The transcript's trailing error, whether it is a usage limit (upstream's `rate_limit` category) and its window. */
function trailingError(lines: readonly SessionLine[]): LimitError | undefined
{
	const line = lastEntryError(lines);
	if (line === undefined) return undefined;
	const usageLimit = line.usageLimit;
	return {
		key: line.uuid ?? String(line.lineIndex),
		isRateLimit: line.isApiErrorMessage === true && (usageLimit !== undefined || isUsageLimitText(lineText(line))),
		...(usageLimit !== undefined &&
		{
			limit:
			{
				resetsAt: usageLimit.resetsAt,
				rateLimitType: usageLimit.rateLimitType,
			},
		}),
	};
}

/**
 * Upstream's auto-resume scheduler (`Pr` with the composer's `onFire` and supersede effect), for a live herdr
 * session: a trailing 5-hour usage-limit error offers an entry (armed per the saved opt-in, local default
 * on); a later non-limit error supersedes it. While armed, the nudge goes out at the reset + 90 s (later
 * attempts at least 45 s out) + 2–8 s jitter, re-checking the clock every 30 s and on wake. At fire time the
 * session must still end in that limit error, take a retry, have an empty composer and nothing parked;
 * otherwise the entry is disarmed. Returns the sr announcement.
 */
export function useLimitAutoResume(options: LimitAutoResumeOptions): string
{
	const {sessionId, lines} = options;
	const latest = useRef(options);
	latest.current = options;
	const [announcement, setAnnouncement] = useState("");
	const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () =>
		{
			clearTimeout(announceTimer.current);
		},
		[],
	);
	const handled = useRef(new Set<string>());
	const error = trailingError(lines);
	const errorKey = error?.key;

	useEffect(() =>
	{
		if (error === undefined) return;
		const key = `${sessionId}:${error.key}`;
		if (handled.current.has(key)) return;
		handled.current.add(key);
		const prev = getAutoResumeEntry(sessionId);
		if (!error.isRateLimit)
		{
			if (prev !== undefined && prev.superseded !== true) setAutoResumeEntry(sessionId, supersede(prev));
			return;
		}
		if (error.limit === undefined) return;
		setAutoResumeEntry(sessionId, offerEntry(prev, error.limit, readOptInPref()));
		// The error's identity is its key; its other fields come from the same line.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionId, errorKey]);

	const stored = useAutoResumeEntry(sessionId);
	const entry = liveEntry(stored, Date.now());
	const armedAt = entry?.armed === true ? `${entry.resetsAt}:${entry.attempt}` : undefined;

	useEffect(() =>
	{
		if (stored !== undefined && entry === undefined && stored.resetsAt <= Date.now() / 1000 - AUTO_RESUME_STALE_S)
			setAutoResumeEntry(sessionId, undefined);
	}, [sessionId, stored, entry]);

	useEffect(() =>
	{
		const armed = getAutoResumeEntry(sessionId);
		if (armedAt === undefined || armed === undefined) return undefined;
		const floor = armed.attempt > 0 ? Date.now() + RETRY_FLOOR_MS : 0;
		const due = Math.max(fireAtSeconds(armed) * 1000, floor) + parkJitterMs(latest.current.random);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let done = false;

		const fire = () =>
		{
			done = true;
			const current = getAutoResumeEntry(sessionId);
			if (current?.armed !== true || current.resetsAt !== armed.resetsAt || current.attempt !== armed.attempt)
				return;
			const {lines: now, retryable, composerText, parked, send} = latest.current;
			const trailing = trailingError(now);
			const sameLimit = trailing?.isRateLimit === true && trailing.limit?.rateLimitType === "five_hour";
			const fresh = (composerText() ?? "").trim() === "";
			if (!sameLimit || !retryable || !fresh || parked() !== false)
			{
				setAutoResumeEntry(
					sessionId,
					{
						...current,
						armed: false,
					},
				);
				return;
			}
			setAutoResumeEntry(sessionId, afterFire(current));
			setAnnouncement("");
			clearTimeout(announceTimer.current);
			announceTimer.current = setTimeout(() =>
			{
				setAnnouncement(RESUMING_ANNOUNCEMENT);
			}, ANNOUNCE_DELAY_MS);
			void send(AUTO_RESUME_NUDGE);
		};

		const tick = () =>
		{
			clearTimeout(timer);
			if (done) return;
			const wait = due - Date.now();
			if (wait <= 0) fire();
			else timer = setTimeout(tick, Math.min(wait, MAX_SLEEP_MS));
		};

		const onVisibility = () =>
		{
			if (document.visibilityState === "visible") tick();
		};
		document.addEventListener("visibilitychange", onVisibility);
		tick();
		return () =>
		{
			done = true;
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [sessionId, armedAt]);

	return announcement;
}
