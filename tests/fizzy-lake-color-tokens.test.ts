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

	it("--upstream-plain-secondary is the pre-rollout muted ink, and upstream's --cds-fizzy-lake-color-plain-secondary under fizzy-lake color", () => {
		const names = ["--upstream-plain-secondary"] as const;
		const contrast = styles.slice(styles.indexOf("@media (prefers-contrast: more)"));
		expect({
			utility: tokens(block("@theme inline"), ["--color-plain-secondary"]),
			base: tokens(block(":root"), names),
			light: tokens(block(FIZZY_LIGHT), names),
			dark: tokens(block(FIZZY_DARK), names),
			contrastLight: tokens(contrast.slice(contrast.indexOf(`${FIZZY_LIGHT} {`)), names),
			contrastDark: tokens(contrast.slice(contrast.indexOf(`${FIZZY_DARK} {`)), names),
		}).toStrictEqual({
			utility: {"--color-plain-secondary": "var(--upstream-plain-secondary)"},
			base: {"--upstream-plain-secondary": "var(--upstream-text-muted)"},
			light: {"--upstream-plain-secondary": "#0009"},
			dark: {"--upstream-plain-secondary": "#ffffff91"},
			contrastLight: {"--upstream-plain-secondary": "#000000bf"},
			contrastDark: {"--upstream-plain-secondary": "#ffffffbf"},
		});
	});

	it("--upstream-warning is upstream's fizzy --cds-text-warning, #794c02 light and #e49c06 dark", () => {
		const names = ["--upstream-warning"] as const;
		expect({
			base: tokens(block(":root"), names),
			baseDark: tokens(block(".dark"), names),
			light: tokens(block(FIZZY_LIGHT), names),
			dark: tokens(block(FIZZY_DARK), names),
		}).toStrictEqual({
			base: {"--upstream-warning": "rgb(115 69 0)"},
			baseDark: {"--upstream-warning": "rgb(219 147 0)"},
			light: {"--upstream-warning": "#794c02"},
			dark: {"--upstream-warning": "#e49c06"},
		});
	});

	it("--menu-shadow's dark ring is upstream's fizzy --cds-border, #ffffff0a, under fizzy-lake color", () => {
		const names = ["--menu-shadow"] as const;
		expect({baseDark: tokens(block(".dark"), names), dark: tokens(block(FIZZY_DARK), names)}).toStrictEqual({
			baseDark: {
				"--menu-shadow":
					"inset 0 0 0 1px hsl(0 0% 100% / 0.1), 0 8px 24px rgba(0, 0, 0, 0.32), 0 2px 6px rgba(0, 0, 0, 0.2)",
			},
			dark: {
				"--menu-shadow":
					"inset 0 0 0 1px #ffffff0a, 0 8px 24px rgba(0, 0, 0, 0.32), 0 2px 6px rgba(0, 0, 0, 0.2)",
			},
		});
	});

	it("--upstream-tint-blue is upstream's fizzy --cds-bg-tint-blue, #257de01f in both modes", () => {
		const names = ["--upstream-tint-blue"] as const;
		expect({light: tokens(block(FIZZY_LIGHT), names), dark: tokens(block(FIZZY_DARK), names)}).toStrictEqual({
			light: {"--upstream-tint-blue": "#257de01f"},
			dark: {"--upstream-tint-blue": null},
		});
	});

	it("maps the rest of upstream's fizzy color block onto the local tokens that play the same role", () => {
		const names = [
			"--upstream-text-primary",
			"--upstream-text-secondary",
			"--upstream-text-muted",
			"--upstream-fill-ghost-selected",
			"--upstream-border",
			"--upstream-surface-1",
			"--upstream-surface-2",
			"--upstream-surface-3",
			"--upstream-surface-popover",
			"--menu-bg",
			"--upstream-fill-primary",
			"--upstream-fill-primary-hover",
			"--upstream-on-primary",
			"--upstream-fill-secondary",
			"--upstream-fill-secondary-hover",
			"--upstream-fill-secondary-ring",
			"--upstream-fill-danger",
			"--upstream-fill-danger-hover",
			"--menu-danger-fill",
			"--upstream-bg-warning",
			"--upstream-bg-danger",
			"--warning-tint",
			"--pro-tint",
			"--muted-as-secondary",
			"--palette-selected",
		] as const;
		expect({light: tokens(block(FIZZY_LIGHT), names), dark: tokens(block(FIZZY_DARK), names)}).toStrictEqual({
			light: {
				"--upstream-text-primary": "#000000e6",
				"--upstream-text-secondary": "#0009",
				"--upstream-text-muted": "#0006",
				"--upstream-fill-ghost-selected": "#0000001a",
				"--upstream-border": "#00000014",
				"--upstream-surface-1": "#fff",
				"--upstream-surface-2": "#fff",
				"--upstream-surface-3": "#fff",
				"--upstream-surface-popover": "#fff",
				"--menu-bg": "#fff",
				"--upstream-fill-primary": "#191919",
				"--upstream-fill-primary-hover": "#3c3c3c",
				"--upstream-on-primary": "#fff",
				"--upstream-fill-secondary": "#0000000d",
				"--upstream-fill-secondary-hover": "#00000013",
				"--upstream-fill-secondary-ring": "var(--upstream-alpha-2)",
				"--upstream-fill-danger": "#dc3c3d",
				"--upstream-fill-danger-hover": "#c63637",
				"--menu-danger-fill": "#dc3c3d",
				"--upstream-bg-warning": "#fbb31529",
				"--upstream-bg-danger": "#dc3c3d1f",
				"--warning-tint": "#fbb31529",
				"--pro-tint": "#785ee81f",
				"--muted-as-secondary": "var(--upstream-text-secondary)",
				"--palette-selected": "var(--upstream-fill-ghost-selected)",
			},
			dark: {
				"--upstream-text-primary": "#ffffffed",
				"--upstream-text-secondary": "#ffffff91",
				"--upstream-text-muted": "#fff6",
				"--upstream-fill-ghost-selected": "#ffffff26",
				"--upstream-border": "#ffffff0a",
				"--upstream-surface-1": "#191919",
				"--upstream-surface-2": "#1f1f1f",
				"--upstream-surface-3": "#1f1f1f",
				"--upstream-surface-popover": "#303030",
				"--menu-bg": "#303030",
				"--upstream-fill-primary": "#efefef",
				"--upstream-fill-primary-hover": "#d7d7d7",
				"--upstream-on-primary": "#191919",
				"--upstream-fill-secondary": "#ffffff26",
				"--upstream-fill-secondary-hover": "#ffffff37",
				"--upstream-fill-secondary-ring": "transparent",
				"--upstream-fill-danger": null,
				"--upstream-fill-danger-hover": null,
				"--menu-danger-fill": null,
				"--upstream-bg-warning": "#fbb31514",
				"--upstream-bg-danger": null,
				"--warning-tint": "#fbb31514",
				"--pro-tint": null,
				"--muted-as-secondary": null,
				"--palette-selected": null,
			},
		});
	});

	it("keeps the pre-rollout values in the base blocks for the newly mapped tokens", () => {
		const names = [
			"--upstream-text-primary",
			"--upstream-text-secondary",
			"--upstream-text-muted",
			"--upstream-fill-ghost-selected",
			"--upstream-border",
			"--upstream-surface-popover",
			"--upstream-fill-danger",
			"--pro-tint",
			"--palette-selected",
		] as const;
		expect({light: tokens(block(":root"), names), dark: tokens(block(".dark"), names)}).toStrictEqual({
			light: {
				"--upstream-text-primary": "rgb(11 11 11)",
				"--upstream-text-secondary": "rgb(82 81 78)",
				"--upstream-text-muted": "#898781",
				"--upstream-fill-ghost-selected": "rgb(11 11 11 / 0.1)",
				"--upstream-border": "hsl(0 0% 4% / 0.1)",
				"--upstream-surface-popover": "#fff",
				"--upstream-fill-danger": "#d03b3b",
				"--pro-tint": "#785ee81f",
				"--palette-selected": "var(--upstream-fill-ghost-hover)",
			},
			dark: {
				"--upstream-text-primary": "#f0efec",
				"--upstream-text-secondary": "#c3c2b7",
				"--upstream-text-muted": "#898781",
				"--upstream-fill-ghost-selected": "rgb(255 255 255 / 0.15)",
				"--upstream-border": "hsl(0 0% 100% / 0.1)",
				"--upstream-surface-popover": "#20201f",
				"--upstream-fill-danger": "#d03b3b",
				"--pro-tint": "#785ee833",
				"--palette-selected": null,
			},
		});
	});

	it("--menu-shadow's light ring is upstream's fizzy --cds-border, #00000014, under fizzy-lake color", () => {
		expect(tokens(block(FIZZY_LIGHT), ["--menu-shadow"])).toStrictEqual({
			"--menu-shadow": "0 0 0 1px #00000014, 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08)",
		});
	});

	it("exposes the palette's selected-row fill as a utility", () => {
		expect(tokens(block("@theme inline"), ["--color-palette-selected"])).toStrictEqual({
			"--color-palette-selected": "var(--palette-selected)",
		});
	});
});
