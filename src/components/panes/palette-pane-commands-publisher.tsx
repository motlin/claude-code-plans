import {useEffect} from "react";

import {assertNever} from "../../lib/assert-never";
import type {PanePaletteCommandId} from "../../lib/palette-pane-commands";
import {clearPanePaletteState, publishPanePaletteState} from "../../lib/palette-pane-commands-store";
import {toggleSideChat, useSideChat} from "../../lib/side-chat-store";
import {setPendingFilterFocus} from "./files-filter-focus";
import {usePaneExpandToggle, usePaneHost} from "./pane-host-context";
import {openNewTerminal, requestTerminalFocus} from "./pending-terminal-focus";

/**
 * Publishes the session page's pane state and handlers for the root ⌘K
 * palette, like upstream's `Lh` registering its pane commands for the active
 * session. Mounted inside `<TileHost>`, which renders only for a found session.
 */
export function PalettePaneCommandsPublisher({
	sessionId,
	terminalAvailable,
	shells,
}: {
	sessionId: string;
	terminalAvailable: boolean;
	shells: boolean;
})
{
	const host = usePaneHost();
	const toggleExpand = usePaneExpandToggle();
	const sideChatOpen = useSideChat(sessionId).open;
	const terminalShown = host.isOpen("terminal");
	const changesShown = host.isOpen("changes");
	const filesShown = host.isOpen("files");
	const closePaneEnabled = host.openKinds.length > 0;
	const paneExpanded = host.layout.expanded !== null;

	useEffect(() =>
	{
		function run(command: PanePaletteCommandId): void
		{
			switch (command)
			{
				case "toggle_terminal_pane":
					// Upstream `_e` with the shown it rendered: bring up a hidden or covered terminal, else close it.
					if (!terminalShown || (host.layout.expanded !== null && host.layout.expanded !== "terminal"))
					{
						requestTerminalFocus();
						host.openPane("terminal");
					}
					else
					{
						host.closePane("terminal");
					}
					return;
				case "toggle_diff_pane":
					host.togglePane("changes");
					return;
				case "toggle_files_pane":
					setPendingFilterFocus(!filesShown);
					host.togglePane("files");
					return;
				case "toggle_side_chat":
					toggleSideChat(sessionId);
					return;
				case "new_terminal":
					openNewTerminal(host);
					return;
				case "close_side_pane":
				{
					const focused = host.layout.focused;
					const target = focused !== "chat" && host.isOpen(focused) ? focused : host.openKinds.at(-1);
					if (target !== undefined) host.closePane(target);
					return;
				}
				case "expand_side_pane":
				case "collapse_side_pane":
					toggleExpand();
					return;
				default:
					assertNever(command);
			}
		}
		publishPanePaletteState(
			{
				sessionId,
				terminal:
				{
					enabled: terminalAvailable,
					shown: terminalShown,
				},
				changes:
				{
					enabled: true,
					shown: changesShown,
				},
				files:
				{
					enabled: true,
					shown: filesShown,
				},
				sideChat:
				{
					enabled: true,
					shown: sideChatOpen,
				},
				newTerminalEnabled: shells,
				closePaneEnabled,
				paneExpanded,
				run,
			},
		);
	}, [
		host,
		toggleExpand,
		sessionId,
		terminalAvailable,
		shells,
		terminalShown,
		changesShown,
		filesShown,
		sideChatOpen,
		closePaneEnabled,
		paneExpanded,
	]);

	useEffect(
		() => () =>
		{
			clearPanePaletteState(sessionId);
		},
		[sessionId],
	);

	return null;
}
