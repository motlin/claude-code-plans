/** Upstream c5d464fa3's claude-light / claude-dark `selectionMatch`. */
const DEFAULT_SELECTION_MATCH =
{
	light: "#0073e61a",
	dark: "#0099ff24",
} as const;

/**
 * Upstream c5d464fa3 `B`: the theme's `editor.selectionHighlightBackground` unless it equals its
 * `editor.selectionBackground`, else `editor.findMatchHighlightBackground`, else the Claude default.
 */
export function selectionMatchColor(colors: Readonly<Record<string, string>>, mode: "light" | "dark"): string
{
	const highlight = colors["editor.selectionHighlightBackground"];
	return (
		(highlight === colors["editor.selectionBackground"] ? undefined : highlight) ??
		colors["editor.findMatchHighlightBackground"] ??
		DEFAULT_SELECTION_MATCH[mode]
	);
}
