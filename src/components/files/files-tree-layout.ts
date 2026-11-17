import {settingStorageKey} from "../settings-context";

const FILES_TREE_DEFAULT_WIDTH = 240;
const FILES_TREE_MIN_WIDTH = 160;
const FILES_TREE_MAX_WIDTH = 640;
export const FILES_TREE_WIDTH_STORAGE_KEY = settingStorageKey("filesTreeWidth");
/** Upstream's `Lk`: the Files body width (default tree + 160px of file) below which the tree and a file can't share it. */
export const FILES_TREE_FIT_MIN_WIDTH = FILES_TREE_DEFAULT_WIDTH + 160;
/** Upstream's `Rk`: the Files pane body, a size container for the tree's narrow-hide query. */
export const FILES_BODY_CLASS = "@container/files-body flex min-h-0 flex-1";
/** Upstream's `Bk`: the tree beside a file hides by CSS under 400px, before the ResizeObserver reports it. */
export const FILES_TREE_NARROW_HIDDEN_CLASS = "@max-[400px]/files-body:hidden";

export function clampFilesTreeWidth(width: number): number
{
	if (!Number.isFinite(width)) return FILES_TREE_DEFAULT_WIDTH;
	return Math.min(FILES_TREE_MAX_WIDTH, Math.max(FILES_TREE_MIN_WIDTH, Math.round(width)));
}

export interface TreeQuery
{
	/** The drilled-in folder, relative to the working directory; "" for the root. */
	dir: string;
	/** Fuzzy path query inside `dir`; "" lists `dir`. */
	search: string;
}

/** Splits the filter at its last "/": everything before it is the drilled-in folder. */
export function parseTreeQuery(query: string): TreeQuery
{
	const trimmed = query.trim();
	const lastSlash = trimmed.lastIndexOf("/");
	if (lastSlash === -1)
		return {
			dir: "",
			search: trimmed,
		};
	return {
		dir: trimmed.slice(0, lastSlash).replace(/^\/+|\/+$/g, ""),
		search: trimmed.slice(lastSlash + 1),
	};
}

/** The "Go up" button for a drilled-in folder: its label and the filter it restores. */
export function goUpTarget(dir: string):
{
	label: string;
	query: string;
}
{
	const segments = dir.split("/");
	if (segments.length <= 1)
		return {
			label: "Go up to project files",
			query: "",
		};
	const parent = segments.slice(0, -1);
	return {
		label: `Go up to ${parent.at(-1)}`,
		query: `${parent.join("/")}/`,
	};
}
