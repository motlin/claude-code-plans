import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
const styles = readFileSync("src/styles/globals.css", "utf8")
	.replaceAll(/\s+/g, " ")
	.replaceAll("( ", "(")
	.replaceAll(" )", ")");

/* Comments quote upstream CSS with unbalanced braces, so the at-rule scan runs on a comment-free copy. */
const code = styles.replaceAll(/\/\*.*?\*\//g, "");

const FZ = ':root[data-cds-fizzy-lake~="color"]';

/** The at-rule preludes enclosing the first occurrence of `selector {`, outermost first. */
function enclosingAtRules(selector: string): string[]
{
	const end = code.indexOf(`${selector} {`);
	if (end === -1) return ["<missing>"];
	const stack: string[] = [];
	let start = 0;
	for (let i = 0; i < end; i++)
	{
		if (code[i] === "{")
		{
			stack.push(code.slice(start, i).trim());
			start = i + 1;
		}
		else if (code[i] === "}")
		{
			stack.pop();
			start = i + 1;
		}
		else if (code[i] === ";")
		{
			start = i + 1;
		}
	}
	return stack.filter((prelude) => prelude.startsWith("@"));
}

function missing(rules: readonly string[]): string[]
{
	return rules.filter((rule) => !styles.includes(rule));
}

const FLOATING_SELECTOR = `${FZ} .bg-surface-3:is(.fixed, .shadow-lg, .shadow-xl, .shadow-2xl, .shadow-panel, .shadow-panel-sm, .shadow-panel-lg, .shadow-popover, .shadow-composer, .shadow-composer-hover, .shadow-composer-focus, .rounded-composer, .rounded-\\[20px\\])`;

describe("fizzy surface hover remaps (upstream shared-styles CPcGcRau)", () =>
{
	/* Removed upstream by shared-styles-Bf7rmMdl, 2026-11-21: rows use hover:bg-fill-ghost-hover directly. */
	it("T1: surface hovers are not remapped to ghost-hover", () =>
	{
		expect(
			[".hover\\:bg-surface-0:hover:not(", ".enabled\\:hover\\:bg-surface-1:enabled:hover"].filter((selector) =>
				styles.includes(selector),
			),
		).toStrictEqual([]);
	});

	it("T1: never restores the gradient layer removed upstream on 11-04", () =>
	{
		expect(styles.includes("linear-gradient(var(--upstream-fill-ghost-hover) 0 0)")).toBe(false);
	});

	/* Removed upstream by shared-styles-Bf7rmMdl, 2026-11-21: focus-visible surfaces no longer paint ghost-selected. */
	it("T2: focus-visible surfaces do not paint ghost-selected", () =>
	{
		expect(
			[
				".focus-visible\\:bg-surface-0:focus-visible:not(",
				"label.focus-within\\:bg-surface-1:focus-within:not(",
			].filter((selector) => styles.includes(selector)),
		).toStrictEqual([]);
	});

	it("T4: floating surface-3 takes the popover surface, unlayered", () =>
	{
		expect(
			{
				missing: missing([
					`${FLOATING_SELECTOR} { --upstream-surface-3: var(--upstream-surface-popover); --color-surface-3: var(--upstream-surface-popover); }`,
				]),
				atRules: enclosingAtRules(FLOATING_SELECTOR),
			},
		).toStrictEqual(
			{
				missing: [],
				atRules: [],
			},
		);
	});
});
