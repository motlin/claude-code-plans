import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
const styles = readFileSync("src/styles/globals.css", "utf8")
	.replaceAll(/\s+/g, " ")
	.replaceAll("( ", "(")
	.replaceAll(" )", ")");

/* `@theme inline` compiles `text-ink-muted` / `text-secondary` to the --upstream-text-* values, so both layers move. */
const TAB_INK =
	':root[data-cds-fizzy-lake~="color"] [data-cds="Tabs"] [role="tab"] { --color-ink-muted: var(--upstream-text-primary); --color-secondary: var(--upstream-text-primary); --upstream-text-muted: var(--upstream-text-primary); --upstream-text-secondary: var(--upstream-text-primary); }';
const TAB_PILL =
	':root[data-cds-fizzy-lake~="color"] [data-cds="Tabs"] [role="tab"][data-active]::before { background-color: var(--upstream-fill-ghost-selected); }';
const RADIO_INK =
	':root[data-cds-fizzy-lake~="color"] [data-cds="SegmentedControl"] [role="radio"] { --settings-segmented-ink: var(--upstream-text-primary); --color-ink-muted: var(--upstream-text-primary); --color-secondary: var(--upstream-text-primary); --upstream-text-muted: var(--upstream-text-primary); --upstream-text-secondary: var(--upstream-text-primary); }';

/** The at-rule preludes enclosing the first occurrence of `rule`, outermost first. */
function enclosingAtRules(rule: string): string[] {
	const end = styles.indexOf(rule);
	if (end === -1) return ["<missing>"];
	const stack: string[] = [];
	let start = 0;
	for (let i = 0; i < end; i++) {
		if (styles[i] === "{") {
			stack.push(styles.slice(start, i).trim());
			start = i + 1;
		} else if (styles[i] === "}") {
			stack.pop();
			start = i + 1;
		} else if (styles[i] === ";") {
			start = i + 1;
		}
	}
	return stack.filter((prelude) => prelude.startsWith("@"));
}

describe("cds Tabs and SegmentedControl fizzy-lake color CSS", () => {
	it("re-inks every tab and radio to control-ink and draws the active tab pill in ghost-selected, outside any media query", () => {
		expect({
			tabInk: enclosingAtRules(TAB_INK),
			tabPill: enclosingAtRules(TAB_PILL),
			radioInk: enclosingAtRules(RADIO_INK),
		}).toStrictEqual({tabInk: [], tabPill: [], radioInk: []});
	});
});
