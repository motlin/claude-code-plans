const BROWSER_ID_KEY = "ccp-browser-id";
const TAB_ID_KEY = "ccp-tab-id";

interface RouteMatchLike {
	routeId: string;
	params: Partial<Record<string, string>>;
}

/** The sessions a tab shows: the `/session/$id…` and `/terminals/…$sessionId` routes it matched. */
export function openSessionIdsFromMatches(matches: readonly RouteMatchLike[]): string[] {
	const ids = new Set<string>();
	for (const {routeId, params} of matches) {
		const id = routeId.startsWith("/session/")
			? params["id"]
			: routeId.startsWith("/terminals/")
				? params["sessionId"]
				: undefined;
		if (id !== undefined && id !== "") ids.add(id);
	}
	return [...ids];
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storedId(storage: StorageLike, key: string): string {
	try {
		const existing = storage.getItem(key);
		if (existing !== null && existing !== "") return existing;
	} catch {
		// Blocked storage: fall through to a fresh id for this page load.
	}
	const id = crypto.randomUUID();
	try {
		storage.setItem(key, id);
	} catch {
		// The id still works for this page load.
	}
	return id;
}

/** Defers the `window.localStorage` read, which itself throws when site data is blocked. */
export function lazyStorage(get: () => Storage): StorageLike {
	return {
		getItem: (key) => get().getItem(key),
		setItem: (key, value) => {
			get().setItem(key, value);
		},
	};
}

/** A per-browser id (pins are per browser) and a per-tab id (each tab has its own open sessions). */
export function keepClientIds(local: StorageLike, session: StorageLike): {browserId: string; tabId: string} {
	return {browserId: storedId(local, BROWSER_ID_KEY), tabId: storedId(session, TAB_ID_KEY)};
}
