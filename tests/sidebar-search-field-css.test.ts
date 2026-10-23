import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");

/** The at-rule preludes enclosing the first occurrence of `selector {`, outermost first. */
function enclosingAtRules(selector: string): string[] {
	const end = styles.indexOf(`${selector} {`);
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

function missing(rules: readonly string[]): string[] {
	return rules.filter((rule) => !styles.includes(rule));
}

describe("sidebar search field CSS", () => {
	it("copies upstream's .df-search-field resting, focus-visible and keys-hint rules", () => {
		expect(
			missing([
				".df-search-field { transition: background-color 60ms cubic-bezier(0.165, 0.84, 0.44, 1); }",
				".df-search-field:not(:focus-visible) { box-shadow: inset 0 0 0 0.5px var(--sb-field-ring), 0 1px 2px 0 #0000000d; }",
				".df-search-field:focus-visible { box-shadow: inset 0 0 0 1px var(--color-accent-100, #2a78d6), 0 0 6px 0 color-mix(in srgb, #2a78d6 20%, transparent); }",
				".df-search-field-keys { opacity: 0; }",
				".df-search-field:focus-visible .df-search-field-keys { opacity: 1; }",
			]),
		).toStrictEqual([]);
	});

	it("shows the hover background, ring and keys hint only on hover-capable pointers", () => {
		expect(
			missing([
				"@media (hover: hover) { .df-search-field:hover { background-color: var(--sb-field-hover); } .df-search-field:hover:not(:focus-visible) { box-shadow: inset 0 0 0 1px var(--sb-field-hover-ring), 0 1px 2px 0 #0000000d; } .df-search-field:hover .df-search-field-keys { opacity: 1; } }",
			]),
		).toStrictEqual([]);
	});

	it("extends the hit area below the row by --cds-hit-gap-y, as upstream's hit-row-main does", () => {
		expect(
			missing([
				".hit-row { position: relative; isolation: isolate; }",
				'.hit-row-main::before { content: ""; position: absolute; z-index: -1; inset: 0 0 calc(var(--cds-hit-gap-y, 0px) * -1); }',
			]),
		).toStrictEqual([]);
	});

	it("defines upstream's light and dark field tokens", () => {
		expect(
			missing([
				"--sb-field-bg: #ffffff80; --sb-field-ring: rgb(11 11 11 / 0.1); --sb-field-hover: rgb(11 11 11 / 0.05); --sb-field-hover-ring: rgb(11 11 11 / 0.1);",
				"--sb-field-bg: hsl(0 0% 100% / 0.05); --sb-field-ring: hsl(0 0% 100% / 0.1); --sb-field-hover: hsl(0 0% 100% / 0.14); --sb-field-hover-ring: transparent;",
			]),
		).toStrictEqual([]);
	});

	it("keeps the field rules unlayered, as upstream does, so the hover background beats the bg utility", () => {
		expect([enclosingAtRules(".df-search-field"), enclosingAtRules(".df-search-field:hover")]).toStrictEqual([
			[],
			["@media (hover: hover)"],
		]);
	});
});
