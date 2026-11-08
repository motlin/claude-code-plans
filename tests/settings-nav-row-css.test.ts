import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");
const flat = styles.replaceAll(/\s+/g, " ");

/** The declarations of the first rule whose selector text is exactly `selector`, whitespace-collapsed. */
function rule(selector: string): string | null {
	const start = flat.indexOf(`${selector} {`);
	if (start === -1) return null;
	return flat.slice(start + selector.length + 2, flat.indexOf("}", start)).trim();
}

describe("settings nav row CSS (upstream S6 / Mc)", () => {
	it("re-points the text-*-control ink at text-primary under fizzy-lake color", () => {
		expect({
			utility: rule("@utility text-secondary-control"),
			ink: /:root\[data-cds-fizzy-lake~="color"\] \{[^}]*--control-ink: var\(--color-primary\);/.test(styles),
		}).toStrictEqual({
			utility: "color: var(--control-ink, var(--color-secondary));",
			ink: true,
		});
	});

	it("layers the ghost hover over a selected row as upstream's hover:layers-1-fill-ghost-hover", () => {
		expect(rule("@utility layers-1-fill-ghost-hover")).toBe(
			"background-image: linear-gradient(var(--color-fill-ghost-hover) 0 0);",
		);
	});

	it("gives dialog nav rows the control weight under fizzy-lake type, rest and selected alike", () => {
		expect(
			rule(
				':root[data-cds-fizzy-lake~="type"]:not([data-interface-font="dyslexic"]) [role="dialog"] nav :is(a, button).text-body.h-8.px-2',
			),
		).toBe(
			'font-weight: var(--font-weight-control); --cds-font-axis-wght: var(--cds-font-axis-wght-control, var(--cds-font-axis-wght-regular)); font-variation-settings: var(--font-opsz-axis,) var(--cds-font-axis-wght,) "GRAD" var(--cds-font-grad, 0);',
		);
	});
});
