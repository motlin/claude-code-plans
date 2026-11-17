import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

import {ruleStart} from "./css-rule";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The declarations of the first `selector` rule after `from`'s position in the stylesheet. */
function declarations(selector: string, from = 0): string[] | null
{
	const start = ruleStart(styles, `\n${selector}`, from);
	if (start === -1) return null;
	const open = styles.indexOf("{", start);
	return styles
		.slice(open + 1, styles.indexOf("}", open))
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => declaration !== "");
}

describe("docked question card actions CSS, as upstream's c2707596b", () =>
{
	it("hides the keycaps in a narrow paged or solo actions row and unpaints an inert pager end", () =>
	{
		expect(
			{
				paged: declarations(
					'\t.epitaxy-question-paged [data-cds="Shortcut"]',
					ruleStart(styles, "@container (width <= 393px)"),
				),
				solo: declarations(
					'\t.epitaxy-question-solo [data-cds="Shortcut"]',
					ruleStart(styles, "@container (width <= 263px)"),
				),
				pagerEnd: declarations(".epitaxy-card-pager-end"),
			},
		).toStrictEqual(
			{
				paged: ["display: none"],
				solo: ["display: none"],
				pagerEnd: ["background: none"],
			},
		);
	});
});
