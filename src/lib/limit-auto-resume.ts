/**
 * claude.ai/code's "Auto-continue when limits reset" (c91b1ad59 `Q`/`gr`/`Pr`/`Dr`): when a session hits its
 * 5-hour usage limit, an armed entry has the page type upstream's after-usage-limit nudge once the window
 * resets. This module is the pure policy plus the per-session entry store the card and the scheduler share.
 * Local is single-user, so the opt-in pref has no per-account suffix and every session is the same account.
 */

/** Upstream `An`: the first fire waits this long past the reset. */
const AUTO_RESUME_FLOOR_MS = 90_000;
/** Upstream `ir`/`Nn`: an entry whose reset is this many seconds old is dropped. */
export const AUTO_RESUME_STALE_S = 21_600;
/** Upstream's attempt budget per window (`gr`'s `attempt < 3`). */
const AUTO_RESUME_MAX_ATTEMPTS = 3;
/** Upstream `Mn`: resets closer than this (seconds) are the same window. */
const SAME_WINDOW_S = 3600;
/** Upstream `sr`: the global opt-in pref's key. */
export const AUTO_RESUME_OPT_IN_KEY = "autoResumeRateLimitOptIn";

export interface AutoResumeEntry
{
	/** Epoch seconds. */
	resetsAt: number;
	attempt: number;
	optedIn: boolean;
	armed: boolean;
	/** Another error came after the limit, so this window never fires. */
	superseded?: true;
}

/** Upstream `gr`: the entry while it still has attempts left and its reset is under 6h old. */
export function liveEntry(entry: AutoResumeEntry | undefined, nowMs: number): AutoResumeEntry | undefined
{
	if (entry === undefined) return undefined;
	if (entry.attempt >= AUTO_RESUME_MAX_ATTEMPTS) return undefined;
	if (entry.resetsAt <= nowMs / 1000 - AUTO_RESUME_STALE_S) return undefined;
	return entry;
}

/**
 * Upstream `Pr`'s upsert for a session's exceeded limit: only the 5-hour window qualifies. A reset within an
 * hour of the previous entry's is the same window and keeps its attempt and supersede. Local defaults on.
 */
export function offerEntry(
	prev: AutoResumeEntry | undefined,
	limit:
	{
		resetsAt: number;
		rateLimitType: string;
	},
	pref: boolean | null,
): AutoResumeEntry | undefined
{
	if (limit.rateLimitType !== "five_hour") return undefined;
	const same = prev !== undefined && Math.abs(limit.resetsAt - prev.resetsAt) < SAME_WINDOW_S;
	const attempt = same ? prev.attempt : 0;
	const superseded = same && prev.superseded === true;
	const optedIn = prev?.optedIn ?? pref ?? true;
	return {
		resetsAt: limit.resetsAt,
		attempt,
		optedIn,
		armed: optedIn && pref !== false && !superseded && attempt < AUTO_RESUME_MAX_ATTEMPTS,
		...(superseded &&
		{
			superseded: true,
		}),
	};
}

function canArm(entry: AutoResumeEntry, nowMs: number): boolean
{
	return entry.attempt < AUTO_RESUME_MAX_ATTEMPTS && entry.resetsAt > nowMs / 1000 - AUTO_RESUME_STALE_S;
}

/** Upstream `Dr`'s own-session upsert: the choice, armed when it can still fire, and no longer superseded. */
export function toggle(entry: AutoResumeEntry, checked: boolean, nowMs: number): AutoResumeEntry
{
	return {
		resetsAt: entry.resetsAt,
		attempt: entry.attempt,
		optedIn: checked,
		armed: checked && canArm(entry, nowMs),
	};
}

/** Upstream `_r` with no host fire time: the reset plus the 90 s floor on the first attempt. */
export function fireAtSeconds(entry: AutoResumeEntry): number
{
	return entry.resetsAt + (entry.attempt === 0 ? Math.round(AUTO_RESUME_FLOOR_MS / 1000) : 0);
}

/** Upstream `kw`: a later non-limit error kills this window's auto-resume. */
export function supersede(entry: AutoResumeEntry): AutoResumeEntry
{
	return {
		...entry,
		armed: false,
		superseded: true,
	};
}

/** Upstream's post-nudge entry: one more attempt spent, disarmed until the limit comes back. */
export function afterFire(entry: AutoResumeEntry): AutoResumeEntry
{
	return {
		...entry,
		attempt: entry.attempt + 1,
		armed: false,
	};
}

/** Upstream `lr`: the global opt-in, or null when the user never chose. */
export function readOptInPref(): boolean | null
{
	try
	{
		const value = localStorage.getItem(AUTO_RESUME_OPT_IN_KEY);
		return value === "true" ? true : value === "false" ? false : null;
	}
	catch
	{
		return null;
	}
}

function writeOptInPref(checked: boolean): void
{
	try
	{
		localStorage.setItem(AUTO_RESUME_OPT_IN_KEY, String(checked));
	}
	catch
	{
		// Private mode: the choice still applies to this page's entries.
	}
}

const entries = new Map<string, AutoResumeEntry>();
const listeners = new Set<() => void>();

export function getAutoResumeEntry(sessionId: string): AutoResumeEntry | undefined
{
	return entries.get(sessionId);
}

export function setAutoResumeEntry(sessionId: string, entry: AutoResumeEntry | undefined): void
{
	if (entries.get(sessionId) === entry) return;
	if (entry === undefined) entries.delete(sessionId);
	else entries.set(sessionId, entry);
	for (const listener of listeners) listener();
}

export function subscribeAutoResume(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Clears every entry; for tests. */
export function resetAutoResumeStore(): void
{
	entries.clear();
	for (const listener of listeners) listener();
}

/**
 * Upstream `Dr` (the checkbox's onCheckedChange): saves the global pref, updates this session, and mirrors the
 * choice to the other sessions: unchecking disarms every armed one, checking re-arms the opted-in ones that
 * aren't superseded, out of attempts or stale.
 */
export function toggleAutoResume(sessionId: string, checked: boolean, nowMs: number): void
{
	writeOptInPref(checked);
	const own = entries.get(sessionId);
	if (own !== undefined) setAutoResumeEntry(sessionId, toggle(own, checked, nowMs));
	for (const [other, entry] of entries)
	{
		if (other === sessionId) continue;
		if (!checked && entry.armed)
			setAutoResumeEntry(
				other,
				{
					...entry,
					armed: false,
				},
			);
		else if (checked && !entry.armed && entry.optedIn && entry.superseded !== true && canArm(entry, nowMs))
			setAutoResumeEntry(
				other,
				{
					...entry,
					armed: true,
				},
			);
	}
}

/** Upstream's `formatTime(ms, {hour: "numeric", minute: "numeric"})`, e.g. "4:01 AM". */
export function formatResumeTime(ms: number): string
{
	return new Date(ms).toLocaleTimeString(
		"en-US",
		{
			hour: "numeric",
			minute: "numeric",
		},
	);
}
