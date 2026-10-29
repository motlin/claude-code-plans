import {useLayoutEffect, useSyncExternalStore} from "react";

/**
 * Whether the client app has committed its first frame.
 *
 * The server-painted app shell (`AppShellFallback`) must stay up until this flips:
 * with `ssr: false` the root route renders nothing until its loaders resolve, so
 * hiding the shell on hydration alone left an empty body for that whole wait.
 */
let mounted = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const getSnapshot = (): boolean => mounted;
const getServerSnapshot = (): boolean => false;

export function useAppMounted(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Marks the app as mounted in a layout effect, so the shell is gone in the same commit the app first paints. */
export function useMarkAppMounted(): void {
	useLayoutEffect(() => {
		if (mounted) return;
		mounted = true;
		for (const listener of listeners) listener();
	}, []);
}
