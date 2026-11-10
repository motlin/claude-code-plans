import {createContext} from "react";

/**
 * The positioned box around the chat tile's scroller, which overlays pinned to
 * the transcript's top edge (the sticky prompt bubble) portal into.
 */
export const TranscriptOverlayHostContext = createContext<HTMLElement | null>(null);
