import {useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * Upstream's dismissed-tasks store (`lI`…`EI`): the Background tasks a session's "Clear finished tasks" hid, kept per
 * browser in localStorage as `{[sessionId]: string[]}`. Local task ids are unique per launch and carry no run id, so
 * every key is the bare task id (upstream's `runId === undefined` branch). Like upstream there is no `storage`
 * listener: another tab sees a dismissal after a reload.
 */
const DISMISSED_TASKS_STORAGE_KEY = "epitaxy.dismissedTasksMap";
/** Upstream `uI`: the most sessions persisted, last-written kept. */
const MAX_SESSIONS = 100;
/** Upstream's `slice(-1e3)`: the most ids persisted per session. */
const MAX_IDS_PER_SESSION = 1000;

const StoredSchema = z.record(z.string(), z.unknown());

const EMPTY: ReadonlySet<string> = Object.freeze(new Set<string>());

const listeners = new Set<() => void>();
/** Loaded from storage on first use; sessions in last-write order. */
let dismissed: Map<string, ReadonlySet<string>> | null = null;

/** Upstream `mI`: anything unparseable reads as no dismissals. */
function load(): Map<string, ReadonlySet<string>>
{
	const map = new Map<string, ReadonlySet<string>>();
	if (typeof window === "undefined") return map;
	try
	{
		const raw = localStorage.getItem(DISMISSED_TASKS_STORAGE_KEY);
		if (raw === null) return map;
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) return map;
		const result = StoredSchema.safeParse(parsed);
		if (!result.success) return map;
		for (const [sessionId, value] of Object.entries(result.data))
		{
			if (!Array.isArray(value)) continue;
			const ids = value.filter((id): id is string => typeof id === "string");
			if (ids.length > 0) map.set(sessionId, new Set(ids));
		}
	}
	catch
	{
		// Unreadable storage: no dismissals.
	}
	return map;
}

function sessions(): Map<string, ReadonlySet<string>>
{
	dismissed ??= load();
	return dismissed;
}

/** Upstream `hI`: the last 100 sessions, each one's last 1000 ids; errors are swallowed. */
function persist(map: Map<string, ReadonlySet<string>>): void
{
	if (typeof window === "undefined") return;
	try
	{
		const entries = [...map].slice(-MAX_SESSIONS);
		localStorage.setItem(
			DISMISSED_TASKS_STORAGE_KEY,
			JSON.stringify(
				Object.fromEntries(
					entries.map(([sessionId, ids]) => [sessionId, [...ids].slice(-MAX_IDS_PER_SESSION)]),
				),
			),
		);
	}
	catch
	{
		// Storage unavailable: memory covers this page load.
	}
}

/** Upstream `gI`: re-inserts the session so the map keeps last-write order, dropping an empty set. */
function commit(sessionId: string, next: ReadonlySet<string>): void
{
	const map = sessions();
	map.delete(sessionId);
	if (next.size > 0) map.set(sessionId, next);
	persist(map);
	for (const listener of [...listeners]) listener();
}

/** Upstream `wI`: hides these task ids in the session; a no-op when every one is already hidden. */
export function dismissTasks(sessionId: string, ids: readonly string[]): void
{
	const current = sessions().get(sessionId) ?? EMPTY;
	const added = ids.filter((id) => !current.has(id));
	if (added.length === 0) return;
	commit(sessionId, new Set([...current, ...added]));
}

/** Upstream `TI`: shows these task ids again; a no-op when none is hidden. */
export function undismissTasks(sessionId: string, ids: readonly string[]): void
{
	const current = sessions().get(sessionId) ?? EMPTY;
	if (!ids.some((id) => current.has(id))) return;
	const remove = new Set(ids);
	commit(sessionId, new Set([...current].filter((id) => !remove.has(id))));
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** Upstream `EI`: the session's dismissed task ids, or one shared empty set. */
export function useDismissedTasks(sessionId: string): ReadonlySet<string>
{
	return useSyncExternalStore(
		subscribe,
		() => sessions().get(sessionId) ?? EMPTY,
		() => EMPTY,
	);
}

/** Forgets the in-memory store so the next use reloads it from storage. */
export function resetDismissedTasksForTests(): void
{
	dismissed = null;
}
