/** The slice of `window` that idle prefetching uses, so tests can drive idleness and visibility by hand. */
export interface IdleHost {
	document: {
		visibilityState: DocumentVisibilityState;
		addEventListener: (type: "visibilitychange", listener: () => void) => void;
		removeEventListener: (type: "visibilitychange", listener: () => void) => void;
	};
	requestIdleCallback?: (callback: () => void, options?: IdleRequestOptions) => number;
	cancelIdleCallback?: (handle: number) => void;
	setTimeout: (callback: () => void, delay?: number) => unknown;
	clearTimeout: (handle: never) => void;
}

/** How long an idle callback may wait for a busy page, and the delay used where requestIdleCallback is missing. */
const IDLE_TIMEOUT_MS = 5000;
const FALLBACK_DELAY_MS = 2000;

/**
 * Starts a deferred chunk's download without waiting on it. The loader is the one its lazy boundary uses, so the
 * boundary later finds the module already in hand; a failure is left for that boundary to retry on open.
 */
function warmChunk(loader: () => Promise<unknown>): void {
	try {
		loader().catch(() => {});
	} catch {
		// A loader that throws synchronously is retried by its boundary like a failed download.
	}
}

/**
 * Warms `loaders` once the page is visible and idle, so a deferred chunk is cached before its first open without
 * joining the cold load. Returns a function that cancels a warm-up that hasn't run yet.
 */
export function prefetchWhenIdle(loaders: ReadonlyArray<() => Promise<unknown>>, host: IdleHost = window): () => void {
	let cancelled = false;
	let cancelScheduled = () => {};
	const run = () => {
		if (cancelled) return;
		cancelled = true;
		for (const loader of loaders) warmChunk(loader);
	};
	const schedule = () => {
		if (host.requestIdleCallback === undefined) {
			const handle = host.setTimeout(run, FALLBACK_DELAY_MS);
			cancelScheduled = () => {
				host.clearTimeout(handle as never);
			};
		} else {
			const handle = host.requestIdleCallback(run, {timeout: IDLE_TIMEOUT_MS});
			cancelScheduled = () => host.cancelIdleCallback?.(handle);
		}
	};
	const onVisibilityChange = () => {
		if (host.document.visibilityState !== "visible") return;
		host.document.removeEventListener("visibilitychange", onVisibilityChange);
		schedule();
	};
	if (host.document.visibilityState === "visible") schedule();
	else host.document.addEventListener("visibilitychange", onVisibilityChange);
	return () => {
		cancelled = true;
		host.document.removeEventListener("visibilitychange", onVisibilityChange);
		cancelScheduled();
	};
}

export interface IntentWarmups {
	/** Chunks to warm when a `[data-prefetch=<key>]` control is hovered or focused. */
	targets: Readonly<Record<string, ReadonlyArray<() => Promise<unknown>>>>;
	/** Chunks to warm when ⌘ or Ctrl goes down, ahead of a shortcut that opens them. */
	modifier: ReadonlyArray<() => Promise<unknown>>;
}

/** Warms a chunk as soon as the user shows intent to open it. Returns a function that stops listening. */
export function warmOnIntent(target: Document, {targets, modifier}: IntentWarmups): () => void {
	const onControl = (event: Event) => {
		const key =
			event.target instanceof Element
				? event.target.closest("[data-prefetch]")?.getAttribute("data-prefetch")
				: undefined;
		for (const loader of (key == null ? undefined : targets[key]) ?? []) warmChunk(loader);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Meta" || event.key === "Control") for (const loader of modifier) warmChunk(loader);
	};
	target.addEventListener("pointerover", onControl, {passive: true});
	target.addEventListener("focusin", onControl);
	target.addEventListener("keydown", onKeyDown);
	return () => {
		target.removeEventListener("pointerover", onControl);
		target.removeEventListener("focusin", onControl);
		target.removeEventListener("keydown", onKeyDown);
	};
}
