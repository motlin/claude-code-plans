/** One style rule from a stylesheet: its selector, enclosing at-rule preludes, and declarations. */
export interface CssRule {
	readonly selector: string;
	readonly atRules: readonly string[];
	readonly declarations: Readonly<Record<string, string>>;
}

/** Whitespace-collapsed, with none just inside parentheses, so formatter line-wrapping doesn't matter. */
const collapse = (text: string) =>
	text.replaceAll(/\s+/g, " ").trim().replaceAll(/\(\s+/g, "(").replaceAll(/\s+\)/g, ")");

/** The members of a selector list, split at top-level commas only. */
function selectorList(selector: string): string[] {
	const members: string[] = [];
	let depth = 0;
	let start = 0;
	let quote: string | null = null;
	for (let index = 0; index < selector.length; index++) {
		const char = selector[index];
		if (quote !== null) {
			if (char === quote) quote = null;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === "(" || char === "[") depth++;
		else if (char === ")" || char === "]") depth--;
		else if (char === "," && depth === 0) {
			members.push(collapse(selector.slice(start, index)));
			start = index + 1;
		}
	}
	members.push(collapse(selector.slice(start)));
	return members;
}

/**
 * Parses a stylesheet into its innermost style rules, with comments stripped and every selector and
 * value whitespace-collapsed, so tests don't depend on how the formatter wraps long selectors.
 * Empty custom-property values (`--x: ;`) are kept as "".
 */
export function parseCssRules(source: string): CssRule[] {
	const css = source.replaceAll(/\/\*[\s\S]*?\*\//g, "");
	const rules: CssRule[] = [];
	const stack: string[] = [];
	let start = 0;
	for (let index = 0; index < css.length; index++) {
		const char = css[index];
		if (char === "{") {
			stack.push(collapse(css.slice(start, index)).replace(/^.*;\s*/, ""));
			start = index + 1;
		} else if (char === "}") {
			const prelude = stack.pop() ?? "";
			const body = css.slice(start, index);
			if (!prelude.startsWith("@") && body.trim() !== "") {
				const declarations: Record<string, string> = {};
				for (const part of body.split(";")) {
					const colon = part.indexOf(":");
					if (colon === -1) continue;
					declarations[collapse(part.slice(0, colon))] = collapse(part.slice(colon + 1));
				}
				rules.push({selector: prelude, atRules: stack.filter((p) => p.startsWith("@")), declarations});
			}
			start = index + 1;
		}
	}
	return rules;
}

/**
 * Declarations of every rule whose selector list contains this selector (whitespace-insensitive), merged in
 * source order.
 */
export function cssDeclarations(
	rules: readonly CssRule[],
	selector: string,
	atRules: readonly string[] = [],
): Record<string, string> | null {
	const wanted = collapse(selector);
	const matches = rules.filter(
		(rule) =>
			selectorList(rule.selector).includes(wanted) &&
			rule.atRules.filter((p) => !p.startsWith("@layer")).join("|") === atRules.join("|"),
	);
	if (matches.length === 0) return null;
	const merged: Record<string, string> = {};
	for (const rule of matches) Object.assign(merged, rule.declarations);
	return merged;
}

/** The subset of a declaration record whose property names match `pattern`. */
export function pickDeclarations(
	declarations: Readonly<Record<string, string>> | null,
	pattern: RegExp,
): Record<string, string> {
	return Object.fromEntries(Object.entries(declarations ?? {}).filter(([name]) => pattern.test(name)));
}
