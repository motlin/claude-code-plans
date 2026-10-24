import {useSyncExternalStore} from "react";

/**
 * A request to open the Background tasks pane at a task, like claude.ai/code's
 * `openTasksPaneAtTask` / `tasksFocusTaskId`. `finished` asks for the Finished
 * section to open.
 */
export interface BackgroundTaskFocus {
	readonly taskId?: string;
	readonly finished: boolean;
}

type FocusListener = (focus: BackgroundTaskFocus) => void;

const focusListeners = new Map<string, Set<FocusListener>>();
const pendingBySession = new Map<string, BackgroundTaskFocus>();

/**
 * Ask the session's Background tasks pane to focus a task. A mounted pane
 * handles it at once; otherwise the pane takes the request when it mounts.
 */
export function requestBackgroundTaskFocus(sessionId: string, focus: BackgroundTaskFocus): void {
	const sessionListeners = focusListeners.get(sessionId);
	if (sessionListeners === undefined || sessionListeners.size === 0) {
		pendingBySession.set(sessionId, focus);
		return;
	}
	for (const listener of sessionListeners) listener(focus);
}

/** Take the request made while the session's Background tasks pane was closed, if any. */
export function takePendingBackgroundTaskFocus(sessionId: string): BackgroundTaskFocus | null {
	const focus = pendingBySession.get(sessionId) ?? null;
	pendingBySession.delete(sessionId);
	return focus;
}

export function onBackgroundTaskFocusRequest(sessionId: string, listener: FocusListener): () => void {
	const sessionListeners = focusListeners.get(sessionId) ?? new Set();
	sessionListeners.add(listener);
	focusListeners.set(sessionId, sessionListeners);
	return () => {
		sessionListeners.delete(listener);
		if (sessionListeners.size === 0) focusListeners.delete(sessionId);
	};
}

/*
 * Per-session pane view state, in memory only like upstream's
 * `finishedExpandedBySession` and `openTaskRowsBySession`: it outlives the pane
 * closing, and a reload resets it.
 */
const EMPTY_ROWS: ReadonlyMap<string, boolean> = new Map();
const finishedBySession = new Map<string, boolean>();
const openRowsBySession = new Map<string, ReadonlyMap<string, boolean>>();
const viewListeners = new Set<() => void>();

function notifyView(): void {
	for (const listener of viewListeners) listener();
}

function subscribeView(listener: () => void): () => void {
	viewListeners.add(listener);
	return () => viewListeners.delete(listener);
}

export function finishedExpanded(sessionId: string): boolean | undefined {
	return finishedBySession.get(sessionId);
}

export function setFinishedExpanded(sessionId: string, open: boolean): void {
	if (finishedBySession.get(sessionId) === open) return;
	finishedBySession.set(sessionId, open);
	notifyView();
}

export function openTaskRows(sessionId: string): ReadonlyMap<string, boolean> {
	return openRowsBySession.get(sessionId) ?? EMPTY_ROWS;
}

export function setTaskRowsOpen(sessionId: string, taskIds: readonly string[], open: boolean): void {
	const current = openTaskRows(sessionId);
	if (taskIds.every((taskId) => current.get(taskId) === open)) return;
	const next = new Map(current);
	for (const taskId of taskIds) next.set(taskId, open);
	openRowsBySession.set(sessionId, next);
	notifyView();
}

/** The session's Finished state; undefined when unset or with no session. */
export function useFinishedExpanded(sessionId: string | undefined): boolean | undefined {
	return useSyncExternalStore(
		subscribeView,
		() => (sessionId === undefined ? undefined : finishedExpanded(sessionId)),
		() => undefined,
	);
}

export function useOpenTaskRows(sessionId: string | undefined): ReadonlyMap<string, boolean> {
	return useSyncExternalStore(
		subscribeView,
		() => (sessionId === undefined ? EMPTY_ROWS : openTaskRows(sessionId)),
		() => EMPTY_ROWS,
	);
}
