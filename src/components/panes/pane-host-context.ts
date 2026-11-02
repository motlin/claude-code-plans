import {createContext, useContext} from "react";

import type {ChatGutters, PaneKind, PaneLayoutState} from "../../lib/pane-layout";

export interface PaneHostApi
{
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

export function usePaneHost(): PaneHostApi
{
	const host = useContext(PaneHostContext);
	if (host === null) throw new Error("usePaneHost must be used inside <TileHost>");
	return host;
}

/** The pane host, or null outside a `<TileHost>` (e.g. a transcript shown on its own). */
export function useOptionalPaneHost(): PaneHostApi | null
{
	return useContext(PaneHostContext);
}

/** Upstream's `data-chat-gutter-*` attributes, present only for a gutter that is shaved or bleeds. */
export interface ChatGutterAttributes
{
	"data-chat-gutter-start"?: NonNullable<ChatGutters["start"]>;
	"data-chat-gutter-end"?: NonNullable<ChatGutters["end"]>;
}

export function chatGutterAttributes(gutters: ChatGutters | null): ChatGutterAttributes
{
	const attributes: ChatGutterAttributes = {};
	if (gutters?.start !== undefined) attributes["data-chat-gutter-start"] = gutters.start;
	if (gutters?.end !== undefined) attributes["data-chat-gutter-end"] = gutters.end;
	return attributes;
}

/** Provided by the chat tile, so the chat panel inside mirrors its gutter attributes like upstream's `.epitaxy-chat-panel`. */
export const ChatGutterContext = createContext<ChatGutterAttributes>({});

export function useChatGutterAttributes(): ChatGutterAttributes
{
	return useContext(ChatGutterContext);
}
