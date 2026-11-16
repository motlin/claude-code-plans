import type {ThemedToken} from "@shikijs/core";

export interface ShikiMark
{
	from: number;
	to: number;
	class: string;
}

export interface ShikiMarks
{
	decorations: ShikiMark[];
	/** Token colors by first appearance; `palette[N]` is `cm-shikiColor${N + 1}`. */
	palette: string[];
}

/* Shiki's FontStyle bit flags. */
const FONT_STYLE_CLASSES: readonly (readonly [number, string])[] = [
	[2, "cm-shikiBold"],
	[1, "cm-shikiItalic"],
	[4, "cm-shikiUnderline"],
	[8, "cm-shikiStrikethrough"],
];

/**
 * Upstream's Shiki → CodeMirror mapping: each token becomes a mark whose class names its color by
 * index (`cm-shikiColorN`, colored by `:where()` theme rules) plus its font style flags.
 * `lineStarts[i]` is the document offset of line `i`.
 */
export function shikiMarks(tokens: readonly (readonly ThemedToken[])[], lineStarts: readonly number[]): ShikiMarks
{
	const palette: string[] = [];
	const indexOf = new Map<string, number>();
	const decorations: ShikiMark[] = [];
	tokens.forEach((line, lineIndex) =>
	{
		const lineStart = lineStarts[lineIndex];
		if (lineStart === undefined) return;
		let from = lineStart;
		for (const token of line)
		{
			const to = from + token.content.length;
			const classes: string[] = [];
			if (token.color !== undefined)
			{
				let index = indexOf.get(token.color);
				if (index === undefined)
				{
					index = palette.length;
					palette.push(token.color);
					indexOf.set(token.color, index);
				}
				classes.push(`cm-shikiColor${index + 1}`);
			}
			const fontStyle = token.fontStyle ?? 0;
			for (const [flag, name] of FONT_STYLE_CLASSES)
			{
				if (fontStyle > 0 && (fontStyle & flag) !== 0) classes.push(name);
			}
			if (to > from && classes.length > 0)
			{
				decorations.push(
					{
						from,
						to,
						class: classes.join(" "),
					},
				);
			}
			from = to;
		}
	});
	return {
		decorations,
		palette,
	};
}
