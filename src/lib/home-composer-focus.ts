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

const prefillListeners = new Set<(text: string) => void>();

/** Ask the mounted home composer, if any, to replace its draft with `text`, focus it and put the caret at the end. */
export function requestHomeComposerPrefill(text: string): void {
	for (const listener of prefillListeners) listener(text);
}

export function onHomeComposerPrefillRequest(listener: (text: string) => void): () => void {
	prefillListeners.add(listener);
	return () => {
		prefillListeners.delete(listener);
	};
}
