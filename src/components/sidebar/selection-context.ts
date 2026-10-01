import {createContext, useContext} from "react";

import type {SessionListItem} from "../../lib/api/sessions";

/** The sidebar's multi-row selection, shared with its rows and their menus. */
export interface SidebarSelectionApi {
	/** Selected rows still shown, in display order. */
	readonly selectedIds: readonly string[];
	/** Every sidebar session by id, for the bulk menu's read and archive state. */
	readonly sessions: ReadonlyMap<string, SessionListItem>;
	/**
	 * Applies a row click to the selection. True when a ⌘- or ⇧-click selected the
	 * row, so the click must not open the session.
	 */
	readonly onRowClick: (id: string, modifiers: {metaKey: boolean; ctrlKey: boolean; shiftKey: boolean}) => boolean;
	/** Adds rows to the selection, as a group header's Select all does. */
	readonly selectAll: (ids: readonly string[]) => void;
	readonly clear: () => void;
}

export const SidebarSelectionContext = createContext<SidebarSelectionApi | null>(null);

/** The sidebar selection, or null outside the sidebar session list. */
export function useSidebarSelection(): SidebarSelectionApi | null {
	return useContext(SidebarSelectionContext);
}

/** The rows a bulk menu opened on `sessionId` acts on, or null for the single-row menu. */
export function bulkSelectionFor(selection: SidebarSelectionApi | null, sessionId: string): readonly string[] | null {
	if (selection === null || selection.selectedIds.length < 2) return null;
	return selection.selectedIds.includes(sessionId) ? selection.selectedIds : null;
}
