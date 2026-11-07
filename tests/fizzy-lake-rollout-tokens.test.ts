import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

import {appearanceCssVars, TYPE_COMFORTABLE_TEXT_SIZES} from "../src/lib/appearance";
import {markdownCss, ruleDeclarations} from "./markdown-css";

/*
 * Upstream's fizzy-lake rollout tokens and component remaps (dumps/fizzy-lake-rollout-tokens-*-2026-11-03.*),
 * .llm/upstream-sync/features/fizzy-lake-rollout-tokens.md T1-T11.
 */

const styles = readFileSync("src/styles/globals.css", "utf8");

/** Comments dropped and whitespace collapsed, so selectors match however the formatter wraps them. */
function normalize(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\(\s/g, "(")
		.replace(/\s\)/g, ")");
}

const flatStyles = normalize(styles);

/** The declarations of the first rule whose selector (list) is exactly `selector`, at any nesting depth. */
function rule(selector: string): Record<string, string> | null {
	const wanted = `${normalize(selector).trim()} {`;
	const open = flatStyles.indexOf(wanted);
	if (open === -1) return null;
	const before = flatStyles[open - 2];
	if (before !== undefined && ![";", "{", "}"].includes(before)) return null;
	const body = flatStyles.slice(open + wanted.length, flatStyles.indexOf("}", open));
	return Object.fromEntries(
		body
			.split(";")
			.map((declaration) => declaration.trim())
			.filter((declaration) => declaration !== "")
			.map((declaration) => {
				const colon = declaration.indexOf(":");
				return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
			}),
	);
}

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

function constant(file: string, name: string): string {
	const match = readFileSync(file, "utf8").match(new RegExp(`const ${name} =\\s*[\`"]([^\`"]+)[\`"]`));
	if (match?.[1] === undefined) throw new Error(`${name} not found in ${file}`);
	return match[1];
}

const BASE = ":root";
const BASE_DARK = ".dark";
const FIZZY_LIGHT = ':root[data-cds-fizzy-lake~="color"]';
const FIZZY_DARK = ':root.dark[data-cds-fizzy-lake~="color"]';
const FIZZY_TYPE = ':root[data-cds-fizzy-lake~="type"]';

describe("fizzy-lake rollout: component remaps under color", () => {
	it("T1: highlighted, focus-visible, popup-open and expanded ghost rows paint ghost-selected (upstream rule 14/15)", () => {
		expect({
			rows: rule(
				[
					':root[data-cds-fizzy-lake~="color"] [class*="data-[highlighted]:bg-fill-ghost-hover"][data-highlighted]',
					':root[data-cds-fizzy-lake~="color"] [data-highlighted] [class*="group-data-[highlighted]/sheet-close:bg-fill-ghost-hover"]',
					':root[data-cds-fizzy-lake~="color"] [class*="focus-visible:bg-fill-ghost-hover"]:focus-visible',
					':root[data-cds-fizzy-lake~="color"] [class*="data-[popup-open]:bg-fill-ghost-hover"][data-popup-open]:not([class*="data-[highlighted]:bg-fill-ghost-hover"])',
					':root[data-cds-fizzy-lake~="color"] [class*="aria-expanded:bg-fill-ghost-hover"][aria-expanded="true"]',
				].join(",\n"),
			),
			hover: rule(
				'\t:root[data-cds-fizzy-lake~="color"]\n\t\t[class*="data-[highlighted]:bg-fill-ghost-hover"][class*="focus-visible:bg-fill-ghost-hover"]:hover',
			),
		}).toStrictEqual({
			rows: {"background-color": "var(--color-fill-ghost-selected)"},
			hover: {"background-color": "var(--color-fill-ghost-selected)"},
		});
	});

	it("T2: popup muted ink (menu labels, shortcut caps, settings muted) is the fizzy secondary; base keeps #898781", () => {
		const names = ["--menu-muted", "--settings-muted"] as const;
		expect({
			base: tokens(block(BASE), names),
			light: tokens(block(FIZZY_LIGHT), names),
			dark: tokens(block(FIZZY_DARK), names),
		}).toStrictEqual({
			base: {"--menu-muted": "#898781", "--settings-muted": "#898781"},
			light: {
				"--menu-muted": "var(--upstream-text-secondary)",
				"--settings-muted": "var(--upstream-text-secondary)",
			},
			dark: {"--menu-muted": null, "--settings-muted": null},
		});
	});

	it("T3: composer chin buttons ink with control-ink at the control weight", () => {
		const chin = constant("src/components/composer-tokens.ts", "CHIN_BUTTON_CLASS").split(" ");
		expect({
			ink: chin.filter((name) => /^text-(secondary|primary|secondary-control)$/.test(name)),
			weight: chin.filter((name) => name.startsWith("font-")),
		}).toStrictEqual({ink: ["text-secondary-control"], weight: ["font-control-regular"]});
	});

	it("T4: placeholders read upstream's fizzy placeholder ink, #878787", () => {
		expect({
			utility: tokens(block("@theme inline"), ["--color-placeholder"]),
			base: tokens(block(BASE), ["--upstream-placeholder"]),
			light: tokens(block(FIZZY_LIGHT), ["--upstream-placeholder"]),
			dark: tokens(block(FIZZY_DARK), ["--upstream-placeholder"]),
			inputs: rule(':root[data-cds-fizzy-lake~="color"] .placeholder\\:text-ink-muted::placeholder'),
			overlay: constant("src/components/composer.tsx", "PLACEHOLDER_OVERLAY_CLASS").includes("text-placeholder"),
		}).toStrictEqual({
			utility: {"--color-placeholder": "var(--upstream-placeholder)"},
			base: {"--upstream-placeholder": "#898781"},
			light: {"--upstream-placeholder": "#878787"},
			dark: {"--upstream-placeholder": null},
			inputs: {color: "var(--upstream-placeholder)"},
			overlay: true,
		});
	});

	it("T5: root muted ink, surface-0, shortcut caps and the dark tooltip take upstream's fizzy values", () => {
		const names = ["--upstream-text-muted", "--upstream-surface-0", "--shortcut-cap-ink", "--tooltip-bg"] as const;
		expect({
			base: tokens(block(BASE), names),
			baseDark: tokens(block(BASE_DARK), names),
			light: tokens(block(FIZZY_LIGHT), names),
			dark: tokens(block(FIZZY_DARK), names),
		}).toStrictEqual({
			base: {
				"--upstream-text-muted": "#898781",
				"--upstream-surface-0": "hsl(60 14% 97%)",
				"--shortcut-cap-ink": "#6d6b67",
				"--tooltip-bg": "rgb(11 11 11)",
			},
			baseDark: {
				"--upstream-text-muted": "#898781",
				"--upstream-surface-0": "#0b0b0b",
				"--shortcut-cap-ink": "#a5a49a",
				"--tooltip-bg": null,
			},
			light: {
				"--upstream-text-muted": "#0007",
				"--upstream-surface-0": "#f9f9f9",
				"--shortcut-cap-ink": "#6b6b6b",
				"--tooltip-bg": null,
			},
			dark: {
				"--upstream-text-muted": "#fff6",
				"--upstream-surface-0": "#0b0b0b",
				"--shortcut-cap-ink": "#a4a4a4",
				"--tooltip-bg": "#303030",
			},
		});
	});

	it("T8: the page is surface-1, the sidebar #fafafa / #1f1f1f, and its seam upstream's 1px fizzy seam", () => {
		const names = ["--upstream-page", "--sb-bg", "--sidebar-seam"] as const;
		const sidebar = readFileSync("src/components/sidebar/Sidebar.tsx", "utf8");
		expect({
			base: tokens(block(BASE), ["--sidebar-seam"]),
			light: tokens(block(FIZZY_LIGHT), names),
			dark: tokens(block(FIZZY_DARK), names),
			border: sidebar.includes(
				"border-r-[length:max(var(--cds-toolbar-line,0px),0.5px)] border-[color:var(--sidebar-seam)] bg-[var(--sb-bg)]",
			),
		}).toStrictEqual({
			base: {"--sidebar-seam": "var(--upstream-border)"},
			light: {
				"--upstream-page": "var(--upstream-surface-1)",
				"--sb-bg": "#fafafa",
				"--sidebar-seam": "var(--upstream-seam)",
			},
			dark: {"--upstream-page": null, "--sb-bg": "#1f1f1f", "--sidebar-seam": null},
			border: true,
		});
	});

	it("T9: the composer ring is upstream's fizzy composer-ring in both shadows", () => {
		const names = ["--composer-ring", "--composer-shadow-idle", "--composer-shadow-focus"] as const;
		expect({light: tokens(block(FIZZY_LIGHT), names), dark: tokens(block(FIZZY_DARK), names)}).toStrictEqual({
			light: {
				"--composer-ring": "#0000001f",
				"--composer-shadow-idle": "0 4px 20px rgb(0 0 0 / 0.035), 0 0 0 1px var(--composer-ring)",
				"--composer-shadow-focus": "0 4px 20px rgb(0 0 0 / 0.075), 0 0 0 1px var(--composer-ring)",
			},
			dark: {
				"--composer-ring": "#ffffff14",
				"--composer-shadow-idle": "0 4px 20px rgb(0 0 0 / 0.035), inset 0 0 0 1px var(--composer-ring)",
				"--composer-shadow-focus": "0 4px 20px rgb(0 0 0 / 0.3), 0 0 0 1px var(--composer-ring)",
			},
		});
	});

	it("T9: panes collapse surface-2/3 to surface-1, and the composer card's surface-3 becomes the popover surface", () => {
		expect({
			pane: rule(':root[data-cds-fizzy-lake~="color"] [data-session-tile]'),
			composer: rule(':root[data-cds-fizzy-lake~="color"] .bg-surface-3.rounded-composer'),
		}).toStrictEqual({
			pane: {
				"--upstream-surface-2": "var(--upstream-surface-1)",
				"--upstream-surface-3": "var(--upstream-surface-1)",
			},
			composer: {"--upstream-surface-3": "var(--upstream-surface-popover)"},
		});
	});

	it("T10: prose table cells border with upstream's fizzy message-line", () => {
		expect({
			light: tokens(block(FIZZY_LIGHT), ["--message-line"]),
			dark: tokens(block(FIZZY_DARK), ["--message-line"]),
			th: ruleDeclarations(markdownCss, ".markdown th")["border-bottom"],
		}).toStrictEqual({
			light: {"--message-line": "#0000001a"},
			dark: {"--message-line": "#ffffff1a"},
			th: "1px solid var(--message-line, var(--color-border))",
		});
	});

	it("T11: selected rows deepen to upstream's fizzy selected-hover", () => {
		const row = readFileSync("src/components/sidebar/session-group-section.tsx", "utf8");
		expect({
			light: tokens(block(FIZZY_LIGHT), ["--selected-hover"]),
			dark: tokens(block(FIZZY_DARK), ["--selected-hover"]),
			ghostSelected: rule('\t:root[data-cds-fizzy-lake~="color"] .bg-fill-ghost-selected:hover'),
			navRow: rule('\t\t.df-nav-row[data-selected="focused"]:hover'),
			sessionRow: row.includes(
				"hover:has-[[data-row-main-button][data-selected=focused]]:bg-[var(--selected-hover,var(--sb-session-selected))]",
			),
		}).toStrictEqual({
			light: {"--selected-hover": "#00000025"},
			dark: {"--selected-hover": "#ffffff37"},
			ghostSelected: {"background-color": "var(--selected-hover)"},
			navRow: {"background-color": "var(--selected-hover, var(--sb-selected))"},
			sessionRow: true,
		});
	});
});

describe("fizzy-lake rollout: type", () => {
	it("T6: under type, comfortable prose and the comfortable prompt drop one step to 14/20, 15/21 and 16/22", () => {
		const px = (rem: string) => Number.parseFloat(rem) * 16;
		const measure = (parts: readonly ("color" | "panels" | "type")[]) =>
			Object.fromEntries(
				(["sm", "md", "lg"] as const).map((transcriptTextSize) => {
					const vars = appearanceCssVars(
						{interfaceFont: "sans", transcriptTextSize, transcriptWidth: "narrow"},
						parts,
					);
					return [
						transcriptTextSize,
						{
							prose: [
								vars["--transcript-comfortable-text-size"],
								vars["--transcript-comfortable-leading"],
							].map((value) => px(value!)),
							prompt: [
								vars["--prompt-comfortable-text-size"],
								vars["--prompt-comfortable-line-height"],
							].map((value) => (value!.endsWith("rem") ? px(value!) : Number.parseFloat(value!))),
						},
					];
				}),
			);
		expect({
			table: TYPE_COMFORTABLE_TEXT_SIZES,
			type: measure(["color", "panels", "type"]),
			preType: measure(["color", "panels"]),
		}).toStrictEqual({
			table: {
				sm: {fontSize: "0.875rem", lineHeight: "1.25rem"},
				md: {fontSize: "0.9375rem", lineHeight: "1.3125rem"},
				lg: {fontSize: "1rem", lineHeight: "1.375rem"},
			},
			type: {
				sm: {prose: [14, 20], prompt: [14, 20]},
				md: {prose: [15, 21], prompt: [15, 21]},
				lg: {prose: [16, 22], prompt: [16, 22]},
			},
			preType: {
				sm: {prose: [15, 22], prompt: [13, 18]},
				md: {prose: [16, 24], prompt: [14, 20]},
				lg: {prose: [18, 27], prompt: [15, 21]},
			},
		});
	});

	it("T6: the prompt and its overlays read the comfortable prompt pair inside a comfortable scope", () => {
		const wanted = [
			"comfortable:[--prompt-text-size:var(--prompt-comfortable-text-size)]",
			"comfortable:[--prompt-line-height:var(--prompt-comfortable-line-height)]",
		];
		const has = (name: string) => {
			const classes = constant("src/components/composer.tsx", name).split(" ");
			return wanted.every((item) => classes.includes(item));
		};
		expect({editor: has("EDITOR_CLASS"), overlay: has("GHOST_OVERLAY_CLASS")}).toStrictEqual({
			editor: true,
			overlay: true,
		});
	});

	it("T7: dialog headings, settings group titles and sidebar group labels take upstream's header weight", () => {
		expect({
			type: tokens(block(FIZZY_TYPE), ["--font-weight-header"]),
			headings: rule(
				[
					':root[data-cds-fizzy-lake~="type"]:not([data-interface-font="dyslexic"])',
					'\t:is([role="dialog"], [role="alertdialog"])\n\t:is(h1, h2).break-words.font-semibold,',
					':root[data-cds-fizzy-lake~="type"]:not([data-interface-font="dyslexic"]) [data-settings-group-title],',
					':root[data-cds-fizzy-lake~="type"]:not([data-interface-font="dyslexic"]) [data-sidebar-group-label]',
				].join("\n"),
			),
		}).toStrictEqual({
			type: {"--font-weight-header": "520"},
			headings: {"font-weight": "var(--font-weight-header)"},
		});
	});
});
