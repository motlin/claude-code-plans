import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

function block(selector: string): string {
	const start = styles.indexOf(`${selector} {`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("\n}", start));
}

function tokens(source: string, names: readonly string[]): Record<string, string | null> {
	return Object.fromEntries(
		names.map((name) => [name, source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null]),
	);
}

const THEME_TOKENS = [
	"--color-fill-secondary",
	"--color-fill-secondary-hover",
	"--color-fill-secondary-ring",
	"--color-fill-danger",
	"--color-fill-danger-hover",
	"--color-on-danger",
	"--shadow-field-drop",
] as const;

const UPSTREAM_TOKENS = [
	"--upstream-fill-secondary",
	"--upstream-fill-secondary-hover",
	"--upstream-fill-secondary-ring",
	"--upstream-fill-danger",
	"--upstream-fill-danger-hover",
] as const;

describe("split-button colour tokens (upstream cds SplitDropdownButton)", () => {
	it("maps the theme utilities onto the upstream variables", () => {
		expect(tokens(block("@theme inline"), THEME_TOKENS)).toStrictEqual({
			"--color-fill-secondary": "var(--upstream-fill-secondary)",
			"--color-fill-secondary-hover": "var(--upstream-fill-secondary-hover)",
			"--color-fill-secondary-ring": "var(--upstream-fill-secondary-ring)",
			"--color-fill-danger": "var(--upstream-fill-danger)",
			"--color-fill-danger-hover": "var(--upstream-fill-danger-hover)",
			"--color-on-danger": "#fff",
			"--shadow-field-drop": "0 1px 2px rgb(0 0 0 / 0.05)",
		});
	});

	it("defines the light values", () => {
		expect(tokens(block(":root"), UPSTREAM_TOKENS)).toStrictEqual({
			"--upstream-fill-secondary": "#ffffff1a",
			"--upstream-fill-secondary-hover": "hsl(0 0% 4% / 0.05)",
			"--upstream-fill-secondary-ring": "hsl(0 0% 4% / 0.1)",
			"--upstream-fill-danger": "#d03b3b",
			"--upstream-fill-danger-hover": "#e34948",
		});
	});

	it("defines the dark values", () => {
		expect(tokens(block(".dark"), UPSTREAM_TOKENS)).toStrictEqual({
			"--upstream-fill-secondary": "hsl(0 0% 100% / 0.1)",
			"--upstream-fill-secondary-hover": "hsl(0 0% 100% / 0.14)",
			"--upstream-fill-secondary-ring": "transparent",
			"--upstream-fill-danger": "#d03b3b",
			"--upstream-fill-danger-hover": "#e34948",
		});
	});
});

describe("alpha-3 token (upstream --cds-alpha-3, neutral-900 at 20%)", () => {
	it("defines the light and dark values", () => {
		expect({
			light: tokens(block(":root"), ["--upstream-alpha-3"]),
			dark: tokens(block(".dark"), ["--upstream-alpha-3"]),
		}).toStrictEqual({
			light: {"--upstream-alpha-3": "rgb(11 11 11 / 0.2)"},
			dark: {"--upstream-alpha-3": "rgb(255 255 255 / 0.2)"},
		});
	});
});

describe("alpha-1 and alpha-2 tokens (upstream --cds-alpha-1/2, neutral-900 at 5% and 10%)", () => {
	it("defines the light and dark values", () => {
		expect({
			light: tokens(block(":root"), ["--upstream-alpha-1", "--upstream-alpha-2"]),
			dark: tokens(block(".dark"), ["--upstream-alpha-1", "--upstream-alpha-2"]),
		}).toStrictEqual({
			light: {"--upstream-alpha-1": "rgb(11 11 11 / 0.05)", "--upstream-alpha-2": "rgb(11 11 11 / 0.1)"},
			dark: {"--upstream-alpha-1": "rgb(255 255 255 / 0.05)", "--upstream-alpha-2": "rgb(255 255 255 / 0.1)"},
		});
	});
});

describe("brand accent tokens (upstream --brand-100 / --oncolor-100)", () => {
	const UPSTREAM_BRAND_TOKENS = ["--upstream-brand-100", "--upstream-oncolor-100"] as const;

	it("maps the theme utilities onto the upstream variables", () => {
		expect(tokens(block("@theme inline"), ["--color-brand-100", "--color-oncolor-100"])).toStrictEqual({
			"--color-brand-100": "var(--upstream-brand-100)",
			"--color-oncolor-100": "var(--upstream-oncolor-100)",
		});
	});

	it("defines the light values (hsl 15 54.2% 51.2%)", () => {
		expect(tokens(block(":root"), UPSTREAM_BRAND_TOKENS)).toStrictEqual({
			"--upstream-brand-100": "rgb(198 97 63)",
			"--upstream-oncolor-100": "rgb(255 255 255)",
		});
	});

	it("defines the dark values (hsl 15 63.1% 59.6%)", () => {
		expect(tokens(block(".dark"), UPSTREAM_BRAND_TOKENS)).toStrictEqual({
			"--upstream-brand-100": "rgb(217 119 87)",
			"--upstream-oncolor-100": "rgb(255 255 255)",
		});
	});
});
