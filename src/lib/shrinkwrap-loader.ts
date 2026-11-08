import type {attachShrinkwrap, restoreShrinkwrap} from "./shrinkwrap";

/** The slice of the shrinkwrap engine its hooks call. */
export interface ShrinkwrapEngine {
	attachShrinkwrap: typeof attachShrinkwrap;
	restoreShrinkwrap: typeof restoreShrinkwrap;
}

// The engine stays off the home page's cold load: tooltips load it at idle or on first hover or focus, and the session
// view, whose user bubbles fit on mount, hands it over with its static import (src/hooks/use-shrinkwrap.ts).
let engine: ShrinkwrapEngine | undefined;
let download: Promise<ShrinkwrapEngine> | undefined;

/** Registers an engine that a static import already loaded, so fits run synchronously from the first render. */
export function provideShrinkwrapEngine(loaded: ShrinkwrapEngine): void {
	engine ??= loaded;
}

/** The engine once loaded, so a fit runs in the same pass as the mount, as with a static import. */
export function loadedShrinkwrapEngine(): ShrinkwrapEngine | undefined {
	return engine;
}

/** The engine's one module download, shared by the shrinkwrap hooks and the idle and intent warm-ups. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download
export function loadShrinkwrapEngine(): Promise<ShrinkwrapEngine> {
	if (engine !== undefined) return Promise.resolve(engine);
	download ??= import("./shrinkwrap")
		.then((module) => {
			engine ??= module;
			return engine;
		})
		.catch((error: unknown) => {
			// A failed download is retried by the next fit.
			download = undefined;
			throw error;
		});
	return download;
}
