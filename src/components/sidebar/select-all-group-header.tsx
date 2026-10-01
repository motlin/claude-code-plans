import type {ReactNode} from "react";

import {familyKey, useSidebarState} from "../../lib/sidebar-store";
import type {SessionGroup, SessionGroupRow} from "../../lib/session-groups";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem} from "../ui/menu";
import {useSidebarSelection} from "./selection-context";

/**
 * The label of a State, Date or ungrouped section, whose right-click menu holds
 * Select all (upstream `group-header-context-menu`): it adds every shown row of
 * the section to the multi-selection, so a row's right-click opens the bulk menu.
 */
export function SelectAllGroupHeader({
	group,
	children,
}: {
	group: SessionGroup<SessionGroupRow>;
	/** The label's toggle button. */
	children: ReactNode;
}) {
	const selection = useSidebarSelection();
	const {collapsedFamilies} = useSidebarState();
	if (selection === null) return children;
	const selectAll = () => {
		const hiddenFamilies = new Set(collapsedFamilies);
		selection.selectAll(
			group.rows.flatMap((row) => [
				row.sessionId,
				...(hiddenFamilies.has(familyKey(row.sessionId))
					? []
					: (group.nested.get(row.sessionId) ?? []).map((child) => child.sessionId)),
			]),
		);
	};
	return (
		<ContextMenu>
			<ContextMenuTrigger className="flex min-w-0 flex-1">{children}</ContextMenuTrigger>
			<MenuContent>
				<MenuItem onSelect={selectAll}>Select all</MenuItem>
			</MenuContent>
		</ContextMenu>
	);
}
