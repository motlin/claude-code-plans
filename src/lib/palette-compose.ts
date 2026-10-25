import type {PaletteMode} from "../hooks/use-command-palette";

export interface PaletteBuffers {
	search: string;
	compose: string;
}

/**
 * The ⌘K palette keeps separate Search and Compose drafts. On a view switch upstream moves the
 * leaving text across only when the destination is blank AND it is entering Compose or the text is
 * a single line, so a multi-line draft never lands in the one-line Search; otherwise each view keeps its own.
 */
export function switchPaletteView(next: PaletteMode, buffers: PaletteBuffers): PaletteBuffers {
	const enteringCompose = next === "compose";
	const leaving = enteringCompose ? buffers.search : buffers.compose;
	const dest = enteringCompose ? buffers.compose : buffers.search;
	if (dest.trim() !== "" || (!enteringCompose && leaving.includes("\n"))) return buffers;
	return enteringCompose ? {search: "", compose: leaving} : {search: leaving, compose: ""};
}

/** Upstream's ⌘K Compose turns a text paste this long into a pasted-text attachment instead of inline text. */
export const PASTE_ATTACH_CHARS = 500;
