// A tab left open across a redeploy still references the previous build's hashed chunks. Once the server stops
// serving one, the next lazy import() fails; reloading picks up the new build. A sessionStorage timestamp guards the
// reload so a chunk that is genuinely missing from the new build shows the error instead of reloading forever.

export const STALE_CHUNK_RELOAD_KEY = "ccb:stale-chunk-reload-at";
export const STALE_CHUNK_GUARD_MS = 30_000;

// Chrome, Safari and Firefox word a failed dynamic import differently; Vite's preload helper adds the CSS one.
const STALE_CHUNK_MESSAGE =
	/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS for/;

export interface StaleChunkReloadDeps {
	storage: () => Storage;
	reload: () => void;
	now: () => number;
}

export const browserStaleChunkDeps: StaleChunkReloadDeps = {
	storage: () => window.sessionStorage,
	reload: () => {
		window.location.reload();
	},
	now: () => Date.now(),
};

export function isStaleChunkError(error: unknown): boolean {
	return error instanceof Error && STALE_CHUNK_MESSAGE.test(error.message);
}

/** Whether a stale-chunk reload already happened within the guard window, so another one would loop. */
export function staleChunkReloadRecent(deps: StaleChunkReloadDeps = browserStaleChunkDeps): boolean {
	try {
		const last = Number(deps.storage().getItem(STALE_CHUNK_RELOAD_KEY));
		return Number.isFinite(last) && last > 0 && deps.now() - last < STALE_CHUNK_GUARD_MS;
	} catch {
		return false;
	}
}

/** Reloads the page unless one already happened within the guard window; returns whether it reloaded. */
export function reloadForStaleChunk(deps: StaleChunkReloadDeps = browserStaleChunkDeps): boolean {
	const now = deps.now();
	try {
		const storage = deps.storage();
		const last = Number(storage.getItem(STALE_CHUNK_RELOAD_KEY));
		if (Number.isFinite(last) && last > 0 && now - last < STALE_CHUNK_GUARD_MS) return false;
		storage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
	} catch {
		// Without a stored guard a reload could loop, so leave the error visible.
		return false;
	}
	deps.reload();
	return true;
}

/** Listens for Vite's preload errors and bare dynamic-import rejections; returns the uninstaller. */
export function installStaleChunkReload(
	target: EventTarget,
	deps: StaleChunkReloadDeps = browserStaleChunkDeps,
): () => void {
	const onPreloadError = (event: Event): void => {
		if (reloadForStaleChunk(deps)) event.preventDefault();
	};
	const onUnhandledRejection = (event: Event): void => {
		const reason: unknown = "reason" in event ? event.reason : undefined;
		if (isStaleChunkError(reason) && reloadForStaleChunk(deps)) event.preventDefault();
	};
	target.addEventListener("vite:preloadError", onPreloadError);
	target.addEventListener("unhandledrejection", onUnhandledRejection);
	return () => {
		target.removeEventListener("vite:preloadError", onPreloadError);
		target.removeEventListener("unhandledrejection", onUnhandledRejection);
	};
}
