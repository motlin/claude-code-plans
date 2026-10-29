import {globSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {__unstable__loadDesignSystem} from "tailwindcss";
import {describe, expect, it} from "vite-plus/test";

const require = createRequire(import.meta.url);
/** A `text-`, `bg-`, or `border-` utility, its arbitrary value and opacity modifier included. */
const COLOUR_PREFIXED_UTILITY =
	/(?<![\w\-[./])(?:text|bg|border)-[a-z][\w-]*(?:\[[^\]\s]*\])?(?:\/(?:\d+|\[[^\]\s]*\]))?/g;

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

	it("gives every text-, bg-, and border- utility in src a rule, so no colour class names an undefined token", async () => {
		const tailwindRoot = dirname(require.resolve("tailwindcss/package.json"));
		const css = readFileSync("src/styles/globals.css", "utf8").replaceAll(/^@import (?!"tailwindcss").*$/gm, "");
		const designSystem = await __unstable__loadDesignSystem(css, {
			base: process.cwd(),
			loadStylesheet: async (id: string, base: string) => {
				const path = id === "tailwindcss" ? join(tailwindRoot, "index.css") : resolve(base, id);
				return Promise.resolve({path, base: dirname(path), content: readFileSync(path, "utf8")});
			},
		});
		const cssClasses = new Set(
			globSync("src/**/*.css").flatMap((path) =>
				[...readFileSync(path, "utf8").matchAll(/\.([a-z][\w-]*)/g)].map(([, name]) => name),
			),
		);
		const utilities = globSync("src/**/*.{ts,tsx}").flatMap((path) => {
			const code = readFileSync(path, "utf8")
				.replaceAll(/\/\*[\s\S]*?\*\//g, "")
				.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
			return [...code.matchAll(COLOUR_PREFIXED_UTILITY)].map(([utility]) => ({path, utility}));
		});
		const rules = designSystem.candidatesToCss(utilities.map(({utility}) => utility));
		const violations: Record<string, string[]> = {};
		utilities.forEach(({path, utility}, index) => {
			if (rules[index] === null && !cssClasses.has(utility)) (violations[path] ??= []).push(utility);
		});

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

	it("floats the phone session-rail card on upstream's measured shadow-panel-md", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
		const dark = styles.slice(styles.indexOf(".dark {"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect({
			utility: token(styles, "--shadow-panel-md"),
			light: token(light, "--panel-md-shadow"),
			dark: token(dark, "--panel-md-shadow"),
		}).toStrictEqual({
			utility: "var(--panel-md-shadow)",
			light: "0 0 0 1px rgb(11 11 11 / 0.1), 0 2px 4px 0 rgb(11 11 11 / 0.07), 0 6px 16px 0 rgb(11 11 11 / 0.08)",
			dark: "inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 2px 4px 0 rgb(11 11 11 / 0.07), 0 6px 16px 0 rgb(0 0 0 / 0.24)",
		});
	});

	it("inks the home Needs input pill in upstream's text-warning", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
		const dark = styles.slice(styles.indexOf(".dark {"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;

		expect({
			utility: token(styles, "--color-upstream-warning"),
			light: token(light, "--upstream-warning"),
			dark: token(dark, "--upstream-warning"),
		}).toStrictEqual({
			utility: "var(--upstream-warning)",
			light: "rgb(115 69 0)",
			// Measured on claude.ai/code: dark text-warning computes to rgb(219, 147, 0).
			dark: "rgb(219 147 0)",
		});
	});

	it("fills the unselected New circle with upstream's web neutral-150 in dark, clearing it only when selected", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(".dark {"));
		const dark = styles.slice(styles.indexOf(".dark {"));
		const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;
		const transparentCircleSelectors = [
			...styles.matchAll(/([^{}]*\.df-new-icon-circle[^{}]*)\{\s*background-color:\s*transparent;/g),
		].map(([, selectors]) => selectors?.trim());

		expect({
			light: token(light, "--sb-new-circle"),
			dark: token(dark, "--sb-new-circle"),
			transparentCircleSelectors,
		}).toStrictEqual({
			light: "#eae9e4",
			// Measured on claude.ai/code: [data-mode=dark] --cds-neutral-150 -> --cds-gray-750.
			dark: "#2c2c2a",
			transparentCircleSelectors: ['.df-nav-row[data-selected="focused"] .df-new-icon-circle'],
		});
	});
	it("paints a selected nav row's leading icon upstream's text-primary, as data-[selected=focused]:[&_.df-leading-slot]:text-primary does", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const leadingSlotColors = [...styles.matchAll(/([^{}]*\.df-leading-slot)\s*\{\s*color:\s*([^;]+);/g)].map(
			([, selector, color]) => [selector?.trim(), color],
		);
		const newRow = readFileSync("src/components/sidebar/new-session-row.tsx", "utf8");

		expect({
			leadingSlotColors,
			newRowOwnSelectedRule: newRow.includes("data-[selected=focused]:[&_.df-leading-slot]:text-primary"),
		}).toStrictEqual({
			leadingSlotColors: [
				[".df-nav-row .df-leading-slot", "var(--upstream-text-secondary)"],
				['.df-nav-row[data-selected="focused"] .df-leading-slot', "var(--upstream-text-primary)"],
			],
			newRowOwnSelectedRule: false,
		});
	});
});
