import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The body of a top-level block (`:root`, `.dark`) of globals.css. */
function block(selector: string): string {
	const start = styles.indexOf(`\n${selector} {`);
	return styles.slice(start, styles.indexOf("\n}", start));
}

const CHART_TOKENS = [
	"--chart-reference",
	"--chart-muted",
	"--chart-reference-tint",
	"--chart-categorical-1",
	"--chart-categorical-2",
	"--chart-categorical-3",
	"--chart-categorical-4",
] as const;

function tokens(selector: string): Record<string, string | null> {
	const body = block(selector);
	return Object.fromEntries(
		CHART_TOKENS.map((name) => [name, body.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1] ?? null]),
	);
}

describe("chart tokens", () => {
	it("defines upstream's light --cds-chart-* values (fizzy-lake off)", () => {
		expect(tokens(":root")).toStrictEqual({
			"--chart-reference": "#898781",
			"--chart-muted": "#c3c2b7",
			"--chart-reference-tint": "hsl(from var(--chart-reference) h s l / 15%)",
			"--chart-categorical-1": "#2a78d6",
			"--chart-categorical-2": "#eb6834",
			"--chart-categorical-3": "#1baf7a",
			"--chart-categorical-4": "#eda100",
		});
	});

	it("defines upstream's dark --cds-chart-* values", () => {
		expect(tokens(".dark")).toStrictEqual({
			"--chart-reference": "#97958d",
			"--chart-muted": "#5f5e5a",
			"--chart-reference-tint": "hsl(from var(--chart-reference) h s l / 15%)",
			"--chart-categorical-1": "#3987e5",
			"--chart-categorical-2": "#d95926",
			"--chart-categorical-3": "#199e70",
			"--chart-categorical-4": "#c98500",
		});
	});
});
