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

const launchFolderListeners = new Set<(projectId: string) => void>();
let pendingLaunchFolderId: string | null = null;

/**
 * Ask home to choose `projectId` as its launch folder: the mounted home applies it now, otherwise
 * the next home to mount applies it once.
 */
export function requestHomeLaunchFolder(projectId: string): void {
	if (launchFolderListeners.size === 0) {
		pendingLaunchFolderId = projectId;
		return;
	}
	for (const listener of launchFolderListeners) listener(projectId);
}

/** The launch folder requested while no home was mounted, cleared so it applies only once. */
export function takePendingHomeLaunchFolder(): string | null {
	const projectId = pendingLaunchFolderId;
	pendingLaunchFolderId = null;
	return projectId;
}

export function onHomeLaunchFolderRequest(listener: (projectId: string) => void): () => void {
	launchFolderListeners.add(listener);
	return () => {
		launchFolderListeners.delete(listener);
	};
}
