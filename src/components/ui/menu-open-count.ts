import {useEffect, useSyncExternalStore} from "react";

/*
 * Upstream `qi`/`Ki`: a per-window count of open menus. Floating selection chips hide (staying
 * mounted) while it is above zero, so they never paint over a menu.
 */
let openMenuCount = 0;
const openMenuListeners = new Set<() => void>();

function setMenuOpen(delta: 1 | -1) {
	openMenuCount += delta;
	for (const listener of openMenuListeners) listener();
}

function subscribeOpenMenus(listener: () => void): () => void {
	openMenuListeners.add(listener);
	return () => {
		openMenuListeners.delete(listener);
	};
}

/** Whether any Menu or ContextMenu in the window is open. */
export function useAnyMenuOpen(): boolean {
	return useSyncExternalStore(
		subscribeOpenMenus,
		() => openMenuCount > 0,
		() => false,
	);
}

/** Counts this root in the window's open menus while it is open. */
export function useOpenMenuCount(open: boolean) {
	useEffect(() => {
		if (!open) return undefined;
		setMenuOpen(1);
		return () => {
			setMenuOpen(-1);
		};
	}, [open]);
}
