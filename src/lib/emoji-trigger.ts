/** The composer's `:shortcode` emoji popup: trigger detection and placement (upstream's emoji-suggestion `allow`/`M` and `G`). */

export interface EmojiTrigger
{
	/** Index of the `:`. */
	start: number;
	/** The token typed after the `:`, up to the caret. */
	query: string;
}

/**
 * The open `:` token before `caret`: a `:` at the line start or after whitespace, followed by no whitespace or `:`.
 * Like upstream's `M`, it only counts while the caret sits at the end of the line or before whitespace.
 */
export function emojiTrigger(text: string, caret: number): EmojiTrigger | null
{
	const after = text.charAt(caret);
	if (after !== "" && after.trim() !== "") return null;
	const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
	const match = /(?:^|\s):([^\s:]*)$/.exec(text.slice(lineStart, caret));
	if (match === null) return null;
	const query = match[1] ?? "";
	return {
		start: caret - query.length - 1,
		query,
	};
}

/** Upstream `I`/`L`: the popup's width and maximum height. */
export const EMOJI_MENU_WIDTH = 280;
const EMOJI_MENU_MAX_HEIGHT = 280;
/** Upstream `R`: the collision padding. */
const EMOJI_MENU_PADDING = 16;
/** Upstream `z`: the vertical offset from the caret's top. */
const EMOJI_MENU_OFFSET = 24;

export interface EmojiMenuPosition
{
	top: number;
	left: number;
	maxHeight: number;
	transform: string;
}

/**
 * Upstream `G`: viewport coordinates for the fixed popup. It opens above the `:` token when there is at least as much
 * room above as below, otherwise below, 24px off the token's top; its height is capped at that room, and it shifts
 * left to stay 16px inside the viewport (right-aligned to the token in RTL).
 */
export function emojiMenuPosition({
	caret,
	viewport,
	rtl,
}: {
	caret:
	{
		top: number;
		left: number;
		right: number;
	};
	viewport:
	{
		width: number;
		height: number;
	};
	rtl: boolean;
}): EmojiMenuPosition
{
	const overflow = caret.left + EMOJI_MENU_WIDTH + EMOJI_MENU_PADDING - viewport.width;
	const left = rtl
		? Math.max(EMOJI_MENU_PADDING, caret.right - EMOJI_MENU_WIDTH)
		: overflow <= 0
			? caret.left
			: Math.max(EMOJI_MENU_PADDING, caret.left - overflow);
	const above = caret.top - EMOJI_MENU_OFFSET - EMOJI_MENU_PADDING;
	const below = viewport.height - caret.top - EMOJI_MENU_OFFSET - EMOJI_MENU_PADDING;
	const opensAbove = above >= below;
	return {
		top: opensAbove ? caret.top - EMOJI_MENU_OFFSET : caret.top + EMOJI_MENU_OFFSET,
		left,
		maxHeight: Math.min(EMOJI_MENU_MAX_HEIGHT, opensAbove ? above : below),
		transform: opensAbove ? "translateY(-100%)" : "",
	};
}
