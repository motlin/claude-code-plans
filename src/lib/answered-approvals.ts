import {useEffect, useRef, useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * Upstream's answered set (shared-39 `Ty`/`s9`/`xr`): approvals answered in
 * this tab, keyed by `${sessionId}:${toolUseId}`. A decision marks its tool
 * call before the answer is sent, and every view treats a marked prompt as
 * consumed, so a signal handoff that redescribes the same call can't redraw
 * it. A failed answer clears the mark and the prompt comes back.
 */
const answered = new Set<string>();

const listeners = new Set<() => void>();

/** Bumped on every mark and clear, like upstream's `u3` counter. */
let version = 0;

function answerKey(sessionId: string, id: string): string
{
	return `${sessionId}:${id}`;
}

function notify(): void
{
	version += 1;
	for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/**
 * Upstream's persisted acknowledged store (shared-39 `C1`/`C0`/`Iw`): a
 * decision whose answer was delivered, kept in localStorage for 5 minutes so a
 * reload in that window still treats the prompt as answered.
 */
const ACKNOWLEDGED_STORAGE_KEY = "acknowledged-tool-decisions";

/** Upstream's `zE`: how long an acknowledged decision keeps its prompt hidden. */
const ACKNOWLEDGED_TTL_MS = 300_000;

/** Upstream's `TQ`: the most acknowledged decisions kept per session. */
const ACKNOWLEDGED_PER_SESSION = 10;

/** Upstream's `Xb`: the stored root and each session's map, lenient about their values. */
const AcknowledgedRecordSchema = z.record(z.string(), z.unknown());

/** Upstream's `Do`: one acknowledged decision; a malformed one is skipped alone. */
const AcknowledgedEntrySchema = z.object(
	{
		toolUseId: z.string(),
		toolName: z.string(),
		acknowledgedAt: z.number(),
	},
);

type Acknowledged = Record<string, Record<string, z.infer<typeof AcknowledgedEntrySchema>>>;

function browserLocalStorage(): Storage | null
{
	if (typeof window === "undefined") return null;
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

/** Upstream's `Iw`/`C0` freshness check: strictly under 5 minutes old. */
function isFresh(acknowledgedAt: number, now: number): boolean
{
	return now - acknowledgedAt < ACKNOWLEDGED_TTL_MS;
}

/** Drops entries past the TTL and sessions left empty. */
function pruneAcknowledged(store: Acknowledged, now: number): Acknowledged
{
	const pruned: Acknowledged = {};
	for (const [sessionId, entries] of Object.entries(store))
	{
		const live = Object.entries(entries).filter(([, entry]) => isFresh(entry.acknowledgedAt, now));
		if (live.length > 0) pruned[sessionId] = Object.fromEntries(live);
	}
	return pruned;
}

/**
 * Upstream's `C0` parse: a session whose value isn't a map, or an entry that
 * fails the entry schema, is skipped on its own rather than discarding the
 * whole store; expired entries and sessions left empty are dropped.
 */
function parseAcknowledged(root: Record<string, unknown>, now: number): Acknowledged
{
	const store: Acknowledged = {};
	for (const [sessionId, value] of Object.entries(root))
	{
		const session = AcknowledgedRecordSchema.safeParse(value);
		if (!session.success) continue;
		const live: Acknowledged[string] = {};
		for (const [id, candidate] of Object.entries(session.data))
		{
			const entry = AcknowledgedEntrySchema.safeParse(candidate);
			if (entry.success && isFresh(entry.data.acknowledgedAt, now)) live[id] = entry.data;
		}
		if (Object.keys(live).length > 0) store[sessionId] = live;
	}
	return store;
}

/** Upstream's `C0`: the stored decisions, pruned on load; unreadable or non-object storage reads as none. */
function loadAcknowledged(): Acknowledged
{
	try
	{
		const raw = browserLocalStorage()?.getItem(ACKNOWLEDGED_STORAGE_KEY) ?? null;
		if (raw === null) return {};
		const parsed = AcknowledgedRecordSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return {};
		const loaded = parseAcknowledged(parsed.data, Date.now());
		saveAcknowledged(loaded);
		return loaded;
	}
	catch
	{
		return {};
	}
}

function saveAcknowledged(store: Acknowledged): void
{
	try
	{
		browserLocalStorage()?.setItem(ACKNOWLEDGED_STORAGE_KEY, JSON.stringify(store));
	}
	catch
	{
		// Quota or denied storage: the in-memory copy still covers this page.
	}
}

let acknowledged: Acknowledged | null = null;

function acknowledgedStore(): Acknowledged
{
	acknowledged ??= loadAcknowledged();
	return acknowledged;
}

/** Upstream's `Iw`: the session's call was acknowledged under 5 minutes ago. */
function isAcknowledged(sessionId: string, id: string): boolean
{
	const entry = acknowledgedStore()[sessionId]?.[id];
	return entry !== undefined && isFresh(entry.acknowledgedAt, Date.now());
}

/**
 * Upstream's `C1`: once a decision's answer is delivered, persist it so a
 * reload within 5 minutes still reads the call as answered. Keeps the newest
 * 10 per session.
 */
export function acknowledgeApproval(sessionId: string, id: string, toolName: string): void
{
	const now = Date.now();
	const store = pruneAcknowledged(acknowledgedStore(), now);
	const entries = Object.entries(store[sessionId] ?? {})
		.filter(([key]) => key !== id)
		.concat([
			[
				id,
				{
					toolUseId: id,
					toolName,
					acknowledgedAt: now,
				},
			],
		])
		.toSorted(([, a], [, b]) => a.acknowledgedAt - b.acknowledgedAt)
		.slice(-ACKNOWLEDGED_PER_SESSION);
	store[sessionId] = Object.fromEntries(entries);
	acknowledged = store;
	saveAcknowledged(store);
	notify();
}

function forgetAcknowledged(sessionId: string, id: string): void
{
	const store = acknowledgedStore();
	const entries = store[sessionId];
	if (entries?.[id] === undefined) return;
	const rest = Object.entries(entries).filter(([key]) => key !== id);
	const others = Object.entries(store).filter(([key]) => key !== sessionId);
	acknowledged = Object.fromEntries(rest.length > 0 ? [...others, [sessionId, Object.fromEntries(rest)]] : others);
	saveAcknowledged(acknowledged);
}

export function markApprovalAnswered(sessionId: string, id: string): void
{
	answered.add(answerKey(sessionId, id));
	notify();
}

export function clearApprovalAnswered(sessionId: string, id: string): void
{
	answered.delete(answerKey(sessionId, id));
	forgetAcknowledged(sessionId, id);
	notify();
}

export function isApprovalAnswered(sessionId: string, id: string): boolean
{
	return answered.has(answerKey(sessionId, id)) || isAcknowledged(sessionId, id);
}

/** Drops every mark and the acknowledged cache with its stored copy, as a fresh page starts; tests call it between cases. */
export function resetAnsweredApprovals(): void
{
	answered.clear();
	acknowledged = null;
	try
	{
		browserLocalStorage()?.removeItem(ACKNOWLEDGED_STORAGE_KEY);
	}
	catch
	{
		// Denied storage holds nothing to clear.
	}
	notify();
}

/** Upstream's `YS`: re-renders whenever any approval is marked or cleared. */
function useAnsweredApprovalsVersion(): number
{
	return useSyncExternalStore(
		subscribe,
		() => version,
		() => 0,
	);
}

/** Whether this tab answered the session's approval `id`; a null id never is. */
export function useApprovalAnswered(sessionId: string, id: string | null): boolean
{
	useAnsweredApprovalsVersion();
	return id !== null && isApprovalAnswered(sessionId, id);
}

/**
 * A hook plan the PermissionRequest reported before any PreToolUse carries no
 * tool call id (""), so its mark would hide the session's next id-less plan.
 * Drop that mark once the hook stops reporting the plan. A real id is never
 * reused, so its mark stays until the record lands and the card goes for good.
 */
export function useForgetAnsweredHookPlan(sessionId: string, hookPlanId: string | null): void
{
	const previous = useRef(hookPlanId);
	useEffect(() =>
	{
		const last = previous.current;
		previous.current = hookPlanId;
		if (last === "" && hookPlanId !== "") clearApprovalAnswered(sessionId, "");
	}, [sessionId, hookPlanId]);
}
