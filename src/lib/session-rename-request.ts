import {useEffect, useRef} from "react";

type Listener = (sessionId: string) => void;

const listeners = new Set<Listener>();

/** Ask the mounted title of `sessionId` to enter inline rename, as the ⌘K Rename command does. */
export function requestSessionRename(sessionId: string): void {
	for (const listener of listeners) listener(sessionId);
}

export function useSessionRenameRequest(sessionId: string, onRequest: () => void): void {
	const onRequestRef = useRef(onRequest);
	onRequestRef.current = onRequest;
	useEffect(() => {
		const listener: Listener = (id) => {
			if (id === sessionId) onRequestRef.current();
		};
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, [sessionId]);
}
