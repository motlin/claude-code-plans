import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const RETIRED_CHROME_UTILITY = /(?:text-text|bg-bg|border-border)-[A-Za-z0-9]+|rounded-\[[0-9]+px\]/g;

describe("app chrome design tokens", () => {
	it("does not use the retired numeric palette or ad-hoc pixel radii", () => {
		const violations = Object.fromEntries(
			globSync("src/**/*.{css,ts,tsx}").flatMap((path) => {
				const matches = [...readFileSync(path, "utf8").matchAll(RETIRED_CHROME_UTILITY)].map(
					([utility]) => utility,
				);
				return matches.length === 0 ? [] : [[path, matches]];
			}),
		);

		expect(violations).toStrictEqual({});
	});

	it("washes the user bubble and inline-code chip in the cds-era 5% alpha layer", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
		const dark = styles.slice(styles.indexOf(".dark {"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect({
			lightBubble: token(light, "--user-msg-bg"),
			darkBubble: token(dark, "--user-msg-bg"),
			lightAlpha: token(light, "--upstream-alpha-1"),
			darkAlpha: token(dark, "--upstream-alpha-1"),
		}).toStrictEqual({
			lightBubble: "var(--upstream-alpha-1)",
			darkBubble: "var(--upstream-alpha-1)",
			lightAlpha: "rgb(11 11 11 / 0.05)",
			darkAlpha: "rgb(255 255 255 / 0.05)",
		});
	});

	it("shadows the dark chat card and side panes with upstream's measured shadow-panel-sm", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const dark = styles.slice(styles.indexOf(".dark {"));

		expect(dark.match(/--pane-shadow:\s*([^;]+);/)?.[1]).toBe(
			"0 1px 2px rgba(11, 11, 11, 0.06), 0 2px 8px rgba(0, 0, 0, 0.24)",
		);
	});

	it("inks the home Needs input pill in upstream's text-warning", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
		const dark = styles.slice(styles.indexOf(".dark {"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect({
			utility: token(styles, "--color-upstream-warning"),
			light: token(light, "--upstream-warning"),
			// No upstream dark sample yet, so dark keeps the warning ink it already had.
			dark: token(dark, "--upstream-warning"),
		}).toStrictEqual({
			utility: "var(--upstream-warning)",
			light: "rgb(115 69 0)",
			dark: "var(--warning-000)",
		});
	});
});
