import {useEffect, useRef} from "react";

type Listener = (sessionId: string) => boolean;

const listeners = new Set<Listener>();

/** A request no mounted title took yet, e.g. ⌘K's row card renaming a session it is navigating to. */
let pending: string | null = null;

/**
 * Ask the title of `sessionId` to enter inline rename, as ⌥⌘R does. When that title is not mounted yet, the
 * request waits for it to mount.
 */
export function requestSessionRename(sessionId: string): void {
	let handled = false;
	for (const listener of listeners) handled = listener(sessionId) || handled;
	pending = handled ? null : sessionId;
}

export function useSessionRenameRequest(sessionId: string, onRequest: () => void): void {
	const onRequestRef = useRef(onRequest);
	onRequestRef.current = onRequest;
	useEffect(() => {
		const listener: Listener = (id) => {
			if (id !== sessionId) return false;
			onRequestRef.current();
			return true;
		};
		listeners.add(listener);
		if (pending === sessionId) {
			pending = null;
			onRequestRef.current();
		}
		return () => {
			listeners.delete(listener);
		};
	}, [sessionId]);
}
