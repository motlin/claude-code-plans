const listeners = new Set<() => void>();

/** Ask the mounted home composer, if any, to focus its prompt. */
export function requestHomeComposerFocus(): void {
	for (const listener of listeners) listener();
}

export function onHomeComposerFocusRequest(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
