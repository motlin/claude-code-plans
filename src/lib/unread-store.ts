import {z} from "zod";
import {updateSessionViewedState} from "./api/viewed-state";

/**
 * Client-side cache of the server's durable `unseen` flag (see
 * `getUnseenSessionIds` in db/viewed-state.ts). The server is the source of
 * truth: session summaries and SSE `session:updated` events seed this cache,
 * and manual actions update it optimistically before persisting.
 */

type ViewedAction = "reviewed" | "unreviewed";
type Persist = (sessionId: string, action: ViewedAction) => Promise<unknown>;

const listeners = new Set<() => void>();
const unseenBySession = new Map<string, boolean>();
let version = 0;

const persistToServer: Persist = async (sessionId, action) => updateSessionViewedState(sessionId, action);
let persist = persistToServer;

/**
 * Upstream's `explicitUnreadIds` (zustand `epitaxy-unread-v1`): sessions this browser marked unread by hand, which
 * the palette leads whatever their age. The server can't tell a hand mark from a turn completion, so the bit is kept
 * per browser, minus upstream's `unreadIds`, which the server owns here.
 */
const EXPLICIT_UNREAD_KEY = "ccb-explicit-unread-v1";
const ExplicitUnreadSchema = z.object(
	{
		state: z.object(
			{
				explicitUnreadIds: z.array(z.string()),
			},
		),
	},
);
let explicitUnread: Set<string> | null = null;

function explicitSet(): Set<string>
{
	if (explicitUnread !== null) return explicitUnread;
	explicitUnread = new Set();
	try
	{
		const raw = localStorage.getItem(EXPLICIT_UNREAD_KEY);
		const parsed = raw === null ? null : ExplicitUnreadSchema.safeParse(JSON.parse(raw));
		if (parsed?.success === true) explicitUnread = new Set(parsed.data.state.explicitUnreadIds);
	}
	catch
	{
		// Unavailable or malformed storage loads as empty.
	}
	return explicitUnread;
}

function saveExplicit(): void
{
	try
	{
		localStorage.setItem(
			EXPLICIT_UNREAD_KEY,
			JSON.stringify(
				{
					state:
					{
						explicitUnreadIds: [...explicitSet()],
					},
					version: 0,
				},
			),
		);
	}
	catch
	{
		// Storage can be unavailable (private mode); the set still holds for this visit.
	}
}

function setExplicit(sessionId: string, explicit: boolean): boolean
{
	const set = explicitSet();
	if (set.has(sessionId) === explicit) return false;
	if (explicit) set.add(sessionId);
	else set.delete(sessionId);
	saveExplicit();
	return true;
}

function emitChange(): void
{
	version++;
	for (const listener of listeners) listener();
}

/** Seen clears the explicit bit too (upstream `markRead` empties both lists); only a hand mark sets it. */
function setUnseen(sessionId: string, unseen: boolean, explicit = false): boolean
{
	let changed = false;
	if ((unseenBySession.get(sessionId) ?? false) !== unseen)
	{
		unseenBySession.set(sessionId, unseen);
		changed = true;
	}
	if ((!unseen || explicit) && setExplicit(sessionId, unseen)) changed = true;
	return changed;
}

/** Adopt the server's flag for every summary; notifies subscribers once if anything changed. */
export function syncUnseenFromSummaries(
	summaries: Iterable<
	{
		id: string;
		unseen: boolean;
	}>,
): void
{
	let changed = false;
	for (const summary of summaries)
	{
		if (setUnseen(summary.id, summary.unseen)) changed = true;
	}
	if (changed) emitChange();
}

function applyOptimistically(sessionId: string, unseen: boolean, explicit = false): void
{
	const previous = unseenBySession.get(sessionId) ?? false;
	const previousExplicit = explicitSet().has(sessionId);
	if (setUnseen(sessionId, unseen, explicit)) emitChange();
	void Promise.resolve()
		.then(async () => persist(sessionId, unseen ? "unreviewed" : "reviewed"))
		.catch((error: unknown) =>
		{
			console.warn("[unread-store] failed to persist unseen flag", error);
			// Roll back only if nothing (such as an SSE summary) has replaced the optimistic value.
			if (unseenBySession.get(sessionId) !== unseen) return;
			const restored = setUnseen(sessionId, previous);
			if (setExplicit(sessionId, previousExplicit) || restored) emitChange();
		});
}

/** `explicit` is a hand "Mark as unread" (upstream `markUnreadExplicit`); automatic paths leave it off. */
export function markUnseen(
	sessionId: string,
	options?:
	{
		explicit?: boolean;
	},
): void
{
	applyOptimistically(sessionId, true, options?.explicit === true);
}

export function markSeen(sessionId: string): void
{
	applyOptimistically(sessionId, false);
}

export function toggleUnseen(sessionId: string): void
{
	if (hasUnseenWork(sessionId)) markSeen(sessionId);
	else
		markUnseen(
			sessionId,
			{
				explicit: true,
			},
		);
}

export function clearAll(): void
{
	for (const [sessionId, unseen] of unseenBySession)
	{
		if (unseen) markSeen(sessionId);
	}
	if (explicitSet().size > 0)
	{
		explicitSet().clear();
		saveExplicit();
		emitChange();
	}
}

export function hasUnseenWork(sessionId: string): boolean
{
	return unseenBySession.get(sessionId) === true;
}

export function isExplicitUnread(sessionId: string): boolean
{
	return explicitSet().has(sessionId);
}

export function explicitUnreadIds(): ReadonlySet<string>
{
	return explicitSet();
}

/** Bumped on every change, for `useSyncExternalStore` readers that depend on many sessions. */
export function unseenWorkVersion(): number
{
	return version;
}

export function subscribeUnseenWork(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export const __unreadStoreTesting =
{
	setPersist(next: Persist): void
	{
		persist = next;
	},
	reset(): void
	{
		persist = persistToServer;
		unseenBySession.clear();
		explicitUnread = new Set();
		emitChange();
	},
};
