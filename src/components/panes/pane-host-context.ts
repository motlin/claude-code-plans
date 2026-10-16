import {createContext, useContext} from "react";

import type {PaneKind, PaneLayoutState} from "../../lib/pane-layout";

export interface PaneHostApi {
	layout: PaneLayoutState;
	/** The side panes in the layout, whose presence swaps the session rail out. */
	openKinds: readonly PaneKind[];
	isOpen: (kind: PaneKind) => boolean;
	openPane: (kind: PaneKind) => void;
	closePane: (kind: PaneKind) => void;
	togglePane: (kind: PaneKind) => void;
}

/** Provided by `<TileHost>`. */
export const PaneHostContext = createContext<PaneHostApi | null>(null);

export function usePaneHost(): PaneHostApi {
	const host = useContext(PaneHostContext);
	if (host === null) throw new Error("usePaneHost must be used inside <TileHost>");
	return host;
}

/** The pane host, or null outside a `<TileHost>` (e.g. a transcript shown on its own). */
export function useOptionalPaneHost(): PaneHostApi | null {
	return useContext(PaneHostContext);
}
