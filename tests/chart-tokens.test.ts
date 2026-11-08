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
	"--chart-categorical-5",
	"--chart-categorical-6",
	"--chart-categorical-7",
	"--chart-categorical-8",
	"--chart-status-good",
	"--chart-status-warning",
	"--chart-status-serious",
	"--chart-status-critical",
] as const;

/* fizzy-lake color ramp from the 2026-11-06 shared-styles dump: categorical blue-400/orange-400/aqua-400/yellow-350/
   magenta-400/green-500/violet-350/red-350 and status green-400/yellow-200/orange-300/red-450. The light values match
   a live claude.ai/code read of .cds-root on 2026-11-07, so both themes share them. */
const FIZZY_PALETTE = {
	"--chart-categorical-1": "#338ced",
	"--chart-categorical-2": "#e76624",
	"--chart-categorical-3": "#00a888",
	"--chart-categorical-4": "#d28e05",
	"--chart-categorical-5": "#e24d8b",
	"--chart-categorical-6": "#008a17",
	"--chart-categorical-7": "#9887ef",
	"--chart-categorical-8": "#eb6263",
	"--chart-status-good": "#0aac23",
	"--chart-status-warning": "#fbb315",
	"--chart-status-serious": "#f18a59",
	"--chart-status-critical": "#dc3c3d",
} as const;

function tokens(selector: string): Record<string, string | null> {
	const body = block(selector);
	return Object.fromEntries(
		CHART_TOKENS.map((name) => [name, body.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1] ?? null]),
	);
}

describe("chart tokens", () => {
	it("defines upstream's light --cds-chart-* values (categorical and status read live 2026-11-07)", () => {
		expect(tokens(":root")).toStrictEqual({
			"--chart-reference": "#898781",
			"--chart-muted": "#c3c2b7",
			"--chart-reference-tint": "hsl(from var(--chart-reference) h s l / 15%)",
			...FIZZY_PALETTE,
		});
	});

	it("defines upstream's dark --cds-chart-* values", () => {
		expect(tokens(".dark")).toStrictEqual({
			"--chart-reference": "#97958d",
			"--chart-muted": "#5f5e5a",
			"--chart-reference-tint": "hsl(from var(--chart-reference) h s l / 15%)",
			...FIZZY_PALETTE,
		});
	});
});
