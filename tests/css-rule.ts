/** `text` with every regular-expression metacharacter escaped, so it matches literally. */
function escapeRegExp(text: string): string
{
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where the rule opened by `selector` starts in `css`, searching from `from`: `selector` followed by whitespace and
 * its `{`, which the formatter puts on a line of its own. -1 when no such rule exists.
 */
export function ruleStart(css: string, selector: string, from = 0): number
{
	const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{`, "g");
	pattern.lastIndex = from;
	return pattern.exec(css)?.index ?? -1;
}
