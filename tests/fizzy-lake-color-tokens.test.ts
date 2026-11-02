import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

/** The declarations of the first top-level rule whose selector is exactly `selector`. */
function block(selector: string): string {
	const start = styles.indexOf(`\n${selector} {`);
	if (start === -1) return "";
	return styles.slice(start, styles.indexOf("\n}", start));
}

function tokens(source: string, names: readonly string[]): Record<string, string | null> {
	return Object.fromEntries(
		names.map((name) => [
			name,
			source.match(new RegExp(`\\s${name}:\\s*([^;]+);`))?.[1]?.replaceAll(/\s+/g, " ") ?? null,
		]),
	);
}

/* Upstream `.cds-root:is([data-cds-fizzy-lake~=color], …)` (light) and its `[data-mode=dark]` twin,
   from dumps/upstream-survey-root-vars.css. */
const FIZZY_LIGHT = ':root[data-cds-fizzy-lake~="color"]';
const FIZZY_DARK = ':root.dark[data-cds-fizzy-lake~="color"]';

describe("fizzy-lake color tokens (upstream data-cds-fizzy-lake~=color)", () => {
	it("--upstream-accent-pressed is upstream's fizzy --cds-bg-accent, #257de0 at 12% in both modes", () => {
		const names = ["--upstream-accent-pressed"] as const;
		expect({light: tokens(block(FIZZY_LIGHT), names), dark: tokens(block(FIZZY_DARK), names)}).toStrictEqual({
			light: {"--upstream-accent-pressed": "color-mix(in srgb, #257de0 12%, transparent)"},
			dark: {"--upstream-accent-pressed": null},
		});
	});

	it("keeps the pre-rollout --cds-bg-accent in the base blocks", () => {
		const names = ["--upstream-accent-pressed"] as const;
		expect({light: tokens(block(":root"), names), dark: tokens(block(".dark"), names)}).toStrictEqual({
			light: {"--upstream-accent-pressed": "rgb(205 226 251)"},
			dark: {"--upstream-accent-pressed": "#032042"},
		});
	});

	it("--upstream-fill-ghost-hover is upstream's fizzy --cds-fill-ghost-hover, #0000000d light and #ffffff13 dark", () => {
		const names = ["--upstream-fill-ghost-hover"] as const;
		expect({light: tokens(block(FIZZY_LIGHT), names), dark: tokens(block(FIZZY_DARK), names)}).toStrictEqual({
			light: {"--upstream-fill-ghost-hover": "#0000000d"},
			dark: {"--upstream-fill-ghost-hover": "#ffffff13"},
		});
	});

	it("--upstream-accent-layer is upstream's fizzy --cds-bg-accent-layer, #257de0 at 6% in both modes", () => {
		expect({
			utility: tokens(block("@theme inline"), ["--color-upstream-accent-layer"]),
			light: tokens(block(FIZZY_LIGHT), ["--upstream-accent-layer"]),
			dark: tokens(block(FIZZY_DARK), ["--upstream-accent-layer"]),
		}).toStrictEqual({
			utility: {"--color-upstream-accent-layer": "var(--upstream-accent-layer)"},
			light: {"--upstream-accent-layer": "#257de00f"},
			dark: {"--upstream-accent-layer": null},
		});
	});
});
