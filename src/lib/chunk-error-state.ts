/** Upstream recovery-kit ErrorView states. */
export type ChunkErrorState = "retry" | "waiting" | "waiting-reload" | "updated" | "reload";

/** Upstream `dg`: the ErrorView copy per state. */
export const CHUNK_ERROR_COPY: Readonly<Record<ChunkErrorState, string>> = {
	retry: "Couldn’t load this.",
	waiting: "You’re offline.",
	"waiting-reload": "You’re offline.",
	updated: "Claude was updated. Reload to continue.",
	reload: "Couldn’t load this. Reload the page to continue.",
};

/** Upstream `NT`: the states whose button reloads the page instead of retrying the download. */
export function reloadsPage(state: ChunkErrorState): boolean {
	return state === "reload" || state === "updated" || state === "waiting-reload";
}

/**
 * Picks the ErrorView state locally: offline waits; once the stale-chunk reload guard has fired another
 * reload would loop, so only a manual reload is left; a download that fails again after Retry while online
 * means the build changed under the tab; otherwise the first failure offers Retry.
 */
export function chunkErrorState({
	online,
	reloadUsed,
	retried,
}: {
	online: boolean;
	reloadUsed: boolean;
	retried: boolean;
}): ChunkErrorState {
	if (!online) return reloadUsed ? "waiting-reload" : "waiting";
	if (reloadUsed) return "reload";
	return retried ? "updated" : "retry";
}
