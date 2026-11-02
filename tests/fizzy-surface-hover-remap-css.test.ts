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

const SURFACE_N_NOT =
	':not([class^="bg-"], [class*=" bg-"], .hover\\:drop-shadow-md):not(:where(.focus-visible\\:bg-surface-1:focus-visible, label.focus-within\\:bg-surface-1:focus-within))';

const HOVER_SELECTOR = [
	`${FZ} .hover\\:bg-surface-0:hover:not(.focus-visible\\:bg-surface-0:focus-visible, .data-\\[popup-open\\]\\:bg-surface-0[data-popup-open], .data-\\[popup-open\\]\\:bg-fill-ghost-hover[data-popup-open], .disabled\\:hover\\:bg-transparent:disabled, .active\\:bg-neutral-30:active, .bg-surface-0, .bg-surface-1, .bg-surface-2, .bg-surface-3, .bg-neutral-30)`,
	`${FZ} .hover\\:bg-surface-1.hover\\:bg-surface-1:hover${SURFACE_N_NOT}`,
	`${FZ} .hover\\:bg-surface-2.hover\\:bg-surface-2:hover${SURFACE_N_NOT}`,
	`${FZ} .hover\\:bg-surface-3.hover\\:bg-surface-3:hover${SURFACE_N_NOT}`,
	`${FZ} .enabled\\:hover\\:bg-surface-1:enabled:hover${SURFACE_N_NOT}`,
].join(", ");

const FOCUS_SELECTOR = [
	`${FZ} .focus-visible\\:bg-surface-0:focus-visible:not(:disabled, .bg-surface-1, .bg-surface-2, .bg-surface-3, .bg-neutral-30)`,
	`${FZ} :where(.focus-visible\\:bg-surface-1):is(.focus-visible\\:bg-surface-1:focus-visible, label.focus-within\\:bg-surface-1:focus-within):not([class^="bg-"], [class*=" bg-"])`,
	`${FZ} label.focus-within\\:bg-surface-1:focus-within:not([class^="bg-"], [class*=" bg-"])`,
].join(", ");

const FLOATING_SELECTOR = `${FZ} .bg-surface-3:is(.fixed, .shadow-lg, .shadow-xl, .shadow-2xl, .shadow-panel, .shadow-panel-sm, .shadow-panel-lg, .shadow-popover, .shadow-composer, .shadow-composer-hover, .shadow-composer-focus, .rounded-composer, .rounded-\\[20px\\])`;

describe("fizzy surface hover remaps (upstream shared-styles CPcGcRau)", () =>
{
	it("T1: surface hovers paint ghost-hover inside the hover media query, unlayered", () =>
	{
		expect(
			{
				missing: missing([`${HOVER_SELECTOR} { background-color: var(--upstream-fill-ghost-hover); }`]),
				atRules: enclosingAtRules(HOVER_SELECTOR),
			},
		).toStrictEqual(
			{
				missing: [],
				atRules: ["@media (hover: hover)"],
			},
		);
	});

	it("T1: never restores the gradient layer removed upstream on 11-04", () =>
	{
		expect(styles.includes("linear-gradient(var(--upstream-fill-ghost-hover) 0 0)")).toBe(false);
	});

	it("T2: focus-visible surfaces paint ghost-selected, unlayered and ungated", () =>
	{
		expect(
			{
				missing: missing([`${FOCUS_SELECTOR} { background-color: var(--upstream-fill-ghost-selected); }`]),
				atRules: enclosingAtRules(FOCUS_SELECTOR),
			},
		).toStrictEqual(
			{
				missing: [],
				atRules: [],
			},
		);
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
