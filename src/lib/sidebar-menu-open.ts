import {useSyncExternalStore} from "react";

/**
 * Upstream's sidebar store flags `overflowMenuOpen`/`sortMenuOpen`: a sidebar menu (a row's menu, context menu or
 * dialog, the whitespace context menu, Group and sort) is open, and whether that menu is Group and sort.
 */
export type SidebarMenuMode = "none" | "menu" | "sort";

let open = false;
let sort = false;
const listeners = new Set<() => void>();

/**
 * Upstream `setOverflowMenuOpen(open, isSort)`: the open menu counts as Group and sort only when it opened first,
 * so a sort menu opened over a row menu is a plain menu. Unchanged calls notify no one.
 */
export function setSidebarMenuOpen(nextOpen: boolean, isSort = false): void
{
	const nextSort = nextOpen && isSort && (sort || !open);
	if (open === nextOpen && sort === nextSort) return;
	open = nextOpen;
	sort = nextSort;
	for (const listener of listeners) listener();
}

export function readSidebarMenuMode(): SidebarMenuMode
{
	if (!open) return "none";
	return sort ? "sort" : "menu";
}

export function subscribeSidebarMenuOpen(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

function subscribeNever(): () => void
{
	return () =>
	{
	};
}

function readNone(): SidebarMenuMode
{
	return "none";
}

/** The open menu's mode, or "none" without subscribing while `enabled` is false (a section that hides nothing). */
export function useSidebarMenuMode(enabled: boolean): SidebarMenuMode
{
	return useSyncExternalStore(
		enabled ? subscribeSidebarMenuOpen : subscribeNever,
		enabled ? readSidebarMenuMode : readNone,
		readNone,
	);
}
