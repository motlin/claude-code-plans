import {z} from "zod";

/**
 * The Files pane's open-file tabs with VS Code preview semantics, as on
 * claude.ai/code: a single click opens an italic preview tab that replaces the
 * previous preview tab, while a double-click (or the "Preview tabs" setting
 * being off) opens an upright pinned tab.
 */

export interface FileTab {
	/** Absolute path of the open file; also the tab's identity. */
	path: string;
	preview: boolean;
}

export interface FileTabsState {
	tabs: FileTab[];
	active: string | null;
}

export type FileTabsAction =
	| {type: "open"; path: string; pin: boolean}
	| {type: "pin"; path: string}
	| {type: "close"; path: string}
	| {type: "move"; path: string; delta: -1 | 1}
	| {type: "reveal"; path: string};

export interface FileTabsOptions {
	/** The "Preview tabs" setting; off pins every open. */
	previewTabs: boolean;
}

export const EMPTY_FILE_TABS: FileTabsState = {tabs: [], active: null};

export const FileTabsStateSchema = z
	.strictObject({
		tabs: z.array(z.strictObject({path: z.string().min(1), preview: z.boolean()})),
		active: z.string().nullable(),
	})
	.superRefine((state, ctx) => {
		const paths = state.tabs.map((tab) => tab.path);
		if (new Set(paths).size !== paths.length) {
			ctx.addIssue({code: "custom", message: "duplicate tab"});
		}
		if (state.tabs.filter((tab) => tab.preview).length > 1) {
			ctx.addIssue({code: "custom", message: "more than one preview tab"});
		}
		if (state.active === null ? paths.length > 0 : !paths.includes(state.active)) {
			ctx.addIssue({code: "custom", message: "active tab is not open"});
		}
	});

function indexOf(state: FileTabsState, path: string): number {
	return state.tabs.findIndex((tab) => tab.path === path);
}

function open(state: FileTabsState, path: string, pin: boolean): FileTabsState {
	const existing = state.tabs[indexOf(state, path)];
	if (existing !== undefined) {
		const preview = existing.preview && !pin;
		if (preview === existing.preview && state.active === path) return state;
		return {
			tabs: state.tabs.map((tab) => (tab.path === path ? {path, preview} : tab)),
			active: path,
		};
	}
	const tab: FileTab = {path, preview: !pin};
	const previewIndex = state.tabs.findIndex((candidate) => candidate.preview);
	if (!pin && previewIndex >= 0) {
		return {
			tabs: state.tabs.map((candidate, index) => (index === previewIndex ? tab : candidate)),
			active: path,
		};
	}
	const tabs = [...state.tabs];
	const activeIndex = state.active === null ? -1 : indexOf(state, state.active);
	tabs.splice(activeIndex < 0 ? tabs.length : activeIndex + 1, 0, tab);
	return {tabs, active: path};
}

function close(state: FileTabsState, path: string): FileTabsState {
	const index = indexOf(state, path);
	if (index < 0) return state;
	const tabs = state.tabs.filter((tab) => tab.path !== path);
	if (state.active !== path) return {...state, tabs};
	const neighbour = tabs[index] ?? tabs[index - 1];
	return {tabs, active: neighbour?.path ?? null};
}

function move(state: FileTabsState, path: string, delta: -1 | 1): FileTabsState {
	const index = indexOf(state, path);
	const target = index + delta;
	const tab = state.tabs[index];
	const neighbour = state.tabs[target];
	if (tab === undefined || neighbour === undefined) return state;
	const tabs = [...state.tabs];
	tabs[index] = neighbour;
	tabs[target] = tab;
	return {...state, tabs};
}

export function fileTabsReducer(state: FileTabsState, action: FileTabsAction, options: FileTabsOptions): FileTabsState {
	switch (action.type) {
		case "open":
			return open(state, action.path, action.pin || !options.previewTabs);
		case "pin": {
			const tab = state.tabs[indexOf(state, action.path)];
			if (tab === undefined || !tab.preview) return state;
			return {
				...state,
				tabs: state.tabs.map((candidate) =>
					candidate.path === action.path ? {...candidate, preview: false} : candidate,
				),
			};
		}
		case "close":
			return close(state, action.path);
		case "move":
			return move(state, action.path, action.delta);
		case "reveal":
			return indexOf(state, action.path) < 0 || state.active === action.path
				? state
				: {...state, active: action.path};
	}
}
