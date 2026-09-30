import type {FileTabsAction, FileTabsState} from "./file-tabs";

/**
 * In-pane editing of `~/.claude` markdown: which files the Files viewer can
 * save, the disk-conflict ETag the save APIs compare, and the guard that asks
 * before a tab action discards unsaved edits.
 */

export const FILE_CONFLICT_MESSAGE = "This file changed on disk since you started editing.";

/** The save API for a file the viewer may edit in place. */
export interface EditableMarkdownTarget {
	kind: "plan" | "memory";
	/** The GET/PUT endpoint, addressed by the `.md`-less slug. */
	url: string;
}

const PLAN_PATH = /\/\.claude\/plans\/([^/]+)\.md$/;
const MEMORY_PATH = /\/\.claude\/projects\/([^/]+)\/memory\/([^/]+)\.md$/;

/** Plans and project memories are editable; every other file stays read-only. */
export function editableMarkdownTarget(path: string): EditableMarkdownTarget | null {
	const plan = PLAN_PATH.exec(path);
	if (plan?.[1] !== undefined) {
		return {kind: "plan", url: `/api/plans/${encodeURIComponent(plan[1])}`};
	}
	const memory = MEMORY_PATH.exec(path);
	if (memory?.[1] !== undefined && memory[2] !== undefined) {
		return {
			kind: "memory",
			url: `/api/projects/${encodeURIComponent(memory[1])}/memories/${encodeURIComponent(memory[2])}`,
		};
	}
	return null;
}

/** The strong ETag the save APIs derive from a file's millisecond mtime. */
export function mtimeEtag(mtime: Date): string {
	return `"${mtime.getTime()}"`;
}

export interface EditGuardState {
	/** The open file with unsaved edits, if any. */
	dirtyPath: string | null;
	/** A tab action waiting on "Discard unsaved changes?". */
	pending: FileTabsAction | null;
}

export type EditGuardEvent =
	| {type: "dirty"; path: string; dirty: boolean}
	| {type: "request"; action: FileTabsAction; tabs: FileTabsState}
	| {type: "discard"}
	| {type: "keepEditing"};

export const EMPTY_EDIT_GUARD: EditGuardState = {dirtyPath: null, pending: null};

function leavesTab(tabs: FileTabsState, action: FileTabsAction, path: string): boolean {
	const open = tabs.tabs.some((tab) => tab.path === path);
	switch (action.type) {
		case "open":
		case "reveal":
			return tabs.active === path && action.path !== path;
		case "close":
			return action.path === path;
		case "closeOthers":
			return open && action.path !== path;
		case "closeAll":
			return open;
		case "pin":
		case "move":
			return false;
	}
}

/**
 * The unsaved-changes guard over tab actions. `forward` is the tab action to
 * apply now; an action that would leave or close the dirty tab is held as
 * `pending` until Discard forwards it or Keep editing drops it.
 */
export function editGuardReducer(
	state: EditGuardState,
	event: EditGuardEvent,
): {state: EditGuardState; forward: FileTabsAction | null} {
	switch (event.type) {
		case "dirty": {
			if (event.dirty) return {state: {...state, dirtyPath: event.path}, forward: null};
			if (state.dirtyPath !== event.path) return {state, forward: null};
			return {state: EMPTY_EDIT_GUARD, forward: null};
		}
		case "request":
			if (state.dirtyPath !== null && leavesTab(event.tabs, event.action, state.dirtyPath)) {
				return {state: {...state, pending: event.action}, forward: null};
			}
			return {state, forward: event.action};
		case "discard":
			return {state: EMPTY_EDIT_GUARD, forward: state.pending};
		case "keepEditing":
			return {state: {...state, pending: null}, forward: null};
	}
}
