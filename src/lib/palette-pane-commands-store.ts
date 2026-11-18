import {useSyncExternalStore} from "react";

import type {PanePaletteCommandId} from "./palette-pane-commands";

export interface PaneToggleState
{
	enabled: boolean;
	shown: boolean;
}

/**
 * The active session page's pane state and handlers, published from inside its
 * `<TileHost>` for the root-mounted ⌘K palette (upstream `Lh` registers them
 * with the command hook only while the session is active).
 */
export interface PanePaletteState
{
	sessionId: string;
	terminal: PaneToggleState;
	changes: PaneToggleState;
	files: PaneToggleState;
	sideChat: PaneToggleState;
	newTerminalEnabled: boolean;
	closePaneEnabled: boolean;
	paneExpanded: boolean;
	run: (command: PanePaletteCommandId) => void;
}

let current: PanePaletteState | null = null;
const listeners = new Set<() => void>();

function emit(): void
{
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void
{
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getPanePaletteState(): PanePaletteState | null
{
	return current;
}

export function publishPanePaletteState(state: PanePaletteState): void
{
	current = state;
	emit();
}

/** Clears only `sessionId`'s state, so a late unmount cannot wipe the page that replaced it. */
export function clearPanePaletteState(sessionId: string): void
{
	if (current?.sessionId !== sessionId) return;
	current = null;
	emit();
}

export function usePanePaletteState(): PanePaletteState | null
{
	return useSyncExternalStore(subscribe, getPanePaletteState, () => null);
}
