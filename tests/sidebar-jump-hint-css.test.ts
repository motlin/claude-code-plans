import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
const styles = readFileSync("src/styles/globals.css", "utf8")
	.replaceAll(/\s+/g, " ")
	.replaceAll("( ", "(")
	.replaceAll(" )", ")");

/** The declarations of the first `selector { … }` block, or null when the rule is missing. */
function declarations(selector: string): string | null
{
	const start = styles.indexOf(`${selector} {`);
	if (start === -1) return null;
	const open = start + selector.length + 2;
	return styles.slice(open, styles.indexOf("}", open)).trim();
}

const ROW = ".df-session-list [data-jump-hint-row]";

describe("sidebar jump-hint CSS", () =>
{
	it("copies upstream's session-list keycap rules with --df-* mapped to --sb-*", () =>
	{
		expect(
			{
				trailingSlot: declarations(`${ROW} > kbd`),
				describedRow: declarations(
					`${ROW}:has(.df-described-row):not(:has(.df-accordion-guide)) > .df-jump-hint`,
				),
				hiddenMarks: declarations(`${ROW}:has(> kbd) :is([data-row-decoration], .df-tail-mark)`),
			},
		).toStrictEqual(
			{
				trailingSlot:
					"inset-inline-start: auto; inset-inline-end: calc(var(--sb-row-ctl-inset, (var(--sb-row-h) - var(--sb-row-ctl)) / 2) + (var(--sb-row-ctl) - 1rem * var(--cds-rem-scale, 1)) / 2);",
				describedRow:
					"top: calc(var(--sb-row-h) / 2 + var(--sb-described-tuck) / 2 - var(--sb-described-trim, 0px));",
				hiddenMarks: "visibility: hidden;",
			},
		);
	});
});
