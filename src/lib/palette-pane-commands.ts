import type {PanePaletteState, PaneToggleState} from "./palette-pane-commands-store";
import type {ShortcutId} from "./shortcuts/registry";

export interface PanePaletteCommand
{
	searchHints: readonly string[];
	shortcut?: ShortcutId;
}

/**
 * Upstream's pane rows in the shared-1 catalog (`I6`), in catalog order. Preview
 * and Browser have no local pane, so `toggle_preview_pane` and
 * `toggle_browser_pane` are left out. New terminal's catalog row has no shortcut.
 */
export const PANE_PALETTE_COMMANDS =
{
	toggle_terminal_pane:
	{
		searchHints: ["shell", "console"],
		shortcut: "toggle_terminal",
	},
	toggle_diff_pane:
	{
		searchHints: ["diff"],
		shortcut: "toggle_changes",
	},
	toggle_files_pane:
	{
		searchHints: ["tree", "explorer"],
		shortcut: "toggle_files",
	},
	toggle_side_chat:
	{
		searchHints: ["btw", "question"],
		shortcut: "toggle_side_chat",
	},
	new_terminal:
	{
		searchHints: ["shell", "console"],
	},
	close_side_pane:
	{
		searchHints: ["panel"],
		shortcut: "close_pane",
	},
	expand_side_pane:
	{
		searchHints: ["panel"],
		shortcut: "expand_collapse_pane",
	},
	collapse_side_pane:
	{
		searchHints: ["panel"],
		shortcut: "expand_collapse_pane",
	},
} as const satisfies Record<string, PanePaletteCommand>;

export type PanePaletteCommandId = keyof typeof PANE_PALETTE_COMMANDS;

export interface PanePaletteAction
{
	id: PanePaletteCommandId;
	label: string;
}

function toggleLabel({shown}: PaneToggleState, noun: string): string
{
	return `${shown ? "Hide" : "Show"} ${noun}`;
}

/** Upstream `Lh`'s gates and live descriptions: a command whose handler is undefined is not listed. */
export function panePaletteActions(state: PanePaletteState | null): PanePaletteAction[]
{
	if (state === null) return [];
	const rows: (PanePaletteAction | false)[] = [
		state.terminal.enabled &&
		{
			id: "toggle_terminal_pane",
			label: toggleLabel(state.terminal, "terminal"),
		},
		state.changes.enabled &&
		{
			id: "toggle_diff_pane",
			label: toggleLabel(state.changes, "changes"),
		},
		state.files.enabled &&
		{
			id: "toggle_files_pane",
			label: toggleLabel(state.files, "files"),
		},
		state.sideChat.enabled &&
		{
			id: "toggle_side_chat",
			label: toggleLabel(state.sideChat, "side chat"),
		},
		state.newTerminalEnabled &&
		{
			id: "new_terminal",
			label: "New terminal",
		},
		state.closePaneEnabled &&
		{
			id: "close_side_pane",
			label: "Close pane",
		},
		state.closePaneEnabled &&
			!state.paneExpanded &&
			{
				id: "expand_side_pane",
				label: "Expand pane",
			},
		state.closePaneEnabled &&
			state.paneExpanded &&
			{
				id: "collapse_side_pane",
				label: "Collapse pane",
			},
	];
	return rows.filter((row) => row !== false);
}
