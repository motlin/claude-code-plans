import {lazy, type MouseEvent, Suspense, useRef, useState} from "react";

import type {SessionListItem} from "../lib/api/sessions";
import type {SessionChipModel, SessionLinkTarget} from "../lib/session-link-href";
import {virtualAnchor} from "./palette-row-actions-geometry";
import {SessionChipMenuBody} from "./session-actions-menu";
import {SessionLinkChip} from "./session-link-chip";
import {Menu, MenuContent} from "./ui/menu";
import {useRenameAfterMenuClose} from "./use-rename-after-menu-close";

// The rename dialog (with the palette card module it lives in) loads with the first chip Rename.
const PaletteRenameDialog = lazy(async () =>
	import("./palette-row-actions").then((module) => (
	{
		default: module.PaletteRenameDialog,
	})),
);

interface PointerPoint
{
	x: number;
	y: number;
}

/**
 * A session chip in assistant prose (upstream `oh` → `kn`): the chip with its hover card and, for a session the
 * index holds, upstream's right-click session menu (`_f`) at the pointer. While the menu or its Rename dialog is
 * open the chip carries `data-menu-open` and shows no card.
 */
export function SessionChipIsland({
	model,
	target,
	session,
}: {
	model: SessionChipModel;
	target: SessionLinkTarget | undefined;
	/** The linked session's row, which the menu acts on; absent leaves the browser's own menu. */
	session: SessionListItem | undefined;
})
{
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuAt, setMenuAt] = useState<PointerPoint>(
		{
			x: 0,
			y: 0,
		},
	);
	const [renaming, setRenaming] = useState(false);
	const chipRef = useRef<HTMLElement | null>(null);
	const renameAfterClose = useRenameAfterMenuClose(() =>
	{
		setRenaming(true);
	});
	const openMenu = (event: MouseEvent<HTMLElement>) =>
	{
		if (session === undefined) return;
		event.preventDefault();
		// The chip's menu stands in for the transcript's message menu.
		event.stopPropagation();
		chipRef.current = event.currentTarget;
		setMenuAt(
			{
				x: event.clientX,
				y: event.clientY,
			},
		);
		setMenuOpen(true);
	};
	return (
		<>
			<SessionLinkChip
				sessionId={model.sessionId}
				{...(model.title === undefined
					? {}
					:
						{
							title: model.title,
						})}
				{...(model.state === undefined
					? {}
					:
						{
							state: model.state,
						})}
				isOpen={model.isOpen}
				{...(model.internalTo === undefined
					? {}
					:
						{
							internalTo: model.internalTo,
						})}
				{...(model.href === undefined
					? {}
					:
						{
							href: model.href,
						})}
				{...(target === undefined
					? {}
					:
						{
							card: target,
						})}
				hoverCardDisabled={menuOpen || renaming}
				menuOpen={menuOpen}
				onContextMenu={openMenu}
			>
				{model.label}
			</SessionLinkChip>
			{session !== undefined && (
				<Menu
					open={menuOpen}
					onOpenChange={setMenuOpen}
					onOpenChangeComplete={renameAfterClose.onOpenChangeComplete}
				>
					<MenuContent
						density="comfortable"
						anchor={virtualAnchor(
							{
								...menuAt,
								width: 0,
								height: 0,
							},
						)}
						side="bottom"
						align="start"
						finalFocus={renameAfterClose.finalFocus}
					>
						<SessionChipMenuBody session={session} requestRename={renameAfterClose.requestRename} />
					</MenuContent>
				</Menu>
			)}
			{session !== undefined && renaming && (
				<Suspense fallback={null}>
					<PaletteRenameDialog
						session={session}
						open
						onClose={() =>
						{
							setRenaming(false);
						}}
						onClosed={() => undefined}
						finalFocus={chipRef}
					/>
				</Suspense>
			)}
		</>
	);
}
