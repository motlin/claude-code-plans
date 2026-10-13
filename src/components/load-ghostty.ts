import {getGhosttyAppearance, type GhosttyAppearance} from "../lib/server-fns";

/**
 * Ghostty parses VT sequences in WebAssembly, so the module has to finish
 * instantiating before a terminal can be constructed.
 */
export async function loadGhostty(): Promise<{
	ghostty: typeof import("ghostty-web");
	appearance: GhosttyAppearance;
}> {
	const [ghostty, appearance] = await Promise.all([import("ghostty-web"), getGhosttyAppearance()]);
	await ghostty.init();
	/**
	 * Ghostty rasterizes glyphs into a canvas that never reflows, so a
	 * webfont still in flight paints Nerd Font symbols as tofu forever.
	 * Canvas text alone does not pull in a self-hosted face, hence the
	 * explicit request for the whole stack before waiting on the set. A
	 * stack the browser rejects costs glyph fidelity, never the terminal.
	 */
	await Promise.all([
		document.fonts.load(`${appearance.fontSize}px ${appearance.fontFamily}`).catch(() => []),
		document.fonts.ready,
	]);
	return {ghostty, appearance};
}
