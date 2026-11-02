// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {renderHook, waitFor} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";
import {ruleStart} from "./css-rule";
import
{
	AA,
	CA,
	DA,
	DIFFS_STYLE_OVERRIDES,
	EA,
	FA,
	JA,
	KA,
	MA,
	NA,
	OA,
	PA,
	SA,
	TA,
	WA,
	diffsInjectedCss,
	filediffBg,
} from "../src/components/changes/diffs-config";
import {claudeDark} from "../src/lib/claude-dark-theme";
import {claudeLight} from "../src/lib/claude-light-theme";
import {CODE_THEME_BG_FALLBACK, useCodeThemeBackground} from "../src/hooks/use-code-theme-background";

const OVERRIDES = DIFFS_STYLE_OVERRIDES as Record<string, string>;
const GLOBALS_CSS = resolve(__dirname, "..", "src", "styles", "globals.css");

// Verbatim from upstream ca7ba268c (dumps/diff-codeview-injected-css-bundle-2026-11-03.txt).
const UPSTREAM =
{
	SA: "[data-diffs-header]{display:none}:is([data-diffs-header]~[data-diff],[data-diffs-header]~[data-file]) [data-code],[data-diff-type=split][data-overflow=wrap]:is([data-diffs-header]~[data-diff]){padding-top:var(--diffs-gap-block,var(--diffs-gap-fallback))}",
	CA: ":is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-gutter-utility-slot]{right:unset;left:5px;justify-content:flex-start}:is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-column-number]{padding-left:calc(2ch + 5px)}",
	WA: "[data-separator-wrapper]{padding-left:8px;grid-template-columns:16px auto;column-gap:4px}[data-separator-wrapper][data-separator-multi-button]{grid-template-columns:16px 16px auto}[data-expand-button]{min-width:16px;border-right:0}[data-separator-content]{grid-column-start:-2;padding:0}[data-separator-wrapper]:has([data-expand-button]):hover :is([data-expand-button],[data-separator-content]){color:var(--cds-text-secondary)}",
	TA: "[data-separator-wrapper]{padding-left:var(--cds-pad-md)}@media (pointer:fine){[data-separator-wrapper][data-separator-multi-button]{grid-template-columns:16px calc(24px - var(--cds-pad-md)) auto}}",
	EA: ":host{--diffs-bg:var(--cds-filediff-bg,var(--cds-surface-1))}",
	DA: ":host{--diffs-selection-base:var(--diffs-selection-color-override,var(--diffs-modified-base))}",
	OA: "[data-overflow=wrap] [data-line]{min-height:1lh}",
	KA: "[data-overflow=wrap]{--diffs-code-grid:var(--diffs-grid-number-column-width) minmax(0,1fr)}",
	AA: '[data-diff],[data-file]{letter-spacing:calc(round(up,1ch,1px/64) - 1ch);font-feature-settings:var(--diffs-font-features,"liga","clig","calt")}',
	JA: '[data-line] span[style*="font-weight"],[data-error-message]{font-variation-settings:normal}',
	MA: "::selection{background-color:var(--cds-code-text-selection-bg,light-dark(color-mix(in srgb,var(--cds-fill-accent) 25%,transparent),color-mix(in srgb,var(--cds-fill-accent) 30%,transparent)))}",
	NA: ":is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-line-number-content],:is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-gutter-buffer]:before{min-width:var(--diffs-min-number-column-width,max(3ch,var(--diffs-min-number-column-width-default,3ch)))}",
	PA: '[data-indicators="classic"] [data-no-newline]{padding-inline-start:2ch}',
	FA: "[data-interactive-line-numbers] [data-column-number],[data-interactive-lines] [data-line],[data-expand-button],[data-expand-index] [data-separator-content],[data-utility-button],[data-merge-conflict-action]{cursor:var(--cds-cursor-interactive)}",
};

const ALWAYS = [EA, DA, OA, KA, AA, JA, MA, NA, PA, FA].join("");

describe("diffsInjectedCss (upstream ca7ba268c za() injectedCSS)", () =>
{
	it("exports upstream's strings verbatim", () =>
	{
		expect(
			{
				SA,
				CA,
				WA,
				TA,
				EA,
				DA,
				OA,
				KA,
				AA,
				JA,
				MA,
				NA,
				PA,
				FA,
			},
		).toStrictEqual(UPSTREAM);
	});

	it("joins the list in upstream's order [Sa,Ca,wa,Ta,Ea..Fa], each conditional string only when asked for", () =>
	{
		const css = (disableFileHeader: boolean, gutterUtility: boolean, panels: boolean) =>
			diffsInjectedCss(
				{
					disableFileHeader,
					gutterUtility,
					panels,
				},
			);
		expect(
			{
				none: css(false, false, false),
				header: css(true, false, false),
				gutter: css(true, true, false),
				panels: css(false, false, true),
				all: css(true, true, true),
			},
		).toStrictEqual(
			{
				none: WA + ALWAYS,
				header: SA + WA + ALWAYS,
				gutter: SA + CA + WA + ALWAYS,
				panels: WA + TA + ALWAYS,
				all: SA + CA + WA + TA + ALWAYS,
			},
		);
	});
});

describe("filediffBg (upstream La)", () =>
{
	it("defaults to surface-1, passes transparent and raw colors through, and maps surface names onto --cds-*", () =>
	{
		expect([
			filediffBg(undefined),
			filediffBg("transparent"),
			filediffBg("surface-2"),
			filediffBg("surface-popover"),
			filediffBg("#123"),
		]).toStrictEqual([
			"var(--cds-surface-1)",
			"transparent",
			"var(--cds-surface-2)",
			"var(--cds-surface-popover)",
			"#123",
		]);
	});
});

describe("useCodeThemeBackground (upstream c6e73333a S)", () =>
{
	it("falls back to the --code-theme-*-bg vars until both themes load, then pairs their editor backgrounds", async () =>
	{
		const {result} = renderHook(() => useCodeThemeBackground());
		expect(result.current).toBe(
			"light-dark(var(--code-theme-light-bg, var(--cds-surface-2)), var(--code-theme-dark-bg, var(--cds-surface-2)))",
		);
		expect(CODE_THEME_BG_FALLBACK).toBe(result.current);
		await waitFor(() =>
		{
			expect(result.current).toBe(
				`light-dark(${claudeLight.colors?.["editor.background"]}, ${claudeDark.colors?.["editor.background"]})`,
			);
		});
		expect(result.current).toBe("light-dark(#ffffff, #191919)");
	});
});

describe("diff host bridge tokens", () =>
{
	it("maps the --cds-* names the injected strings read onto local tokens, with upstream's selection and modified inks", () =>
	{
		expect(
			{
				textSecondary: OVERRIDES["--cds-text-secondary"],
				fillAccent: OVERRIDES["--cds-fill-accent"],
				surface1: OVERRIDES["--cds-surface-1"],
				surface2: OVERRIDES["--cds-surface-2"],
				cursor: OVERRIDES["--cds-cursor-interactive"],
				padMd: OVERRIDES["--cds-pad-md"],
				modified: OVERRIDES["--diffs-modified-color-override"],
				selection: OVERRIDES["--diffs-selection-color-override"],
				selectionBg: OVERRIDES["--diffs-bg-selection-override"],
				selectionNumberBg: OVERRIDES["--diffs-bg-selection-number-override"],
				fontFeatures: OVERRIDES["--diffs-font-features"],
			},
		).toStrictEqual(
			{
				textSecondary: "var(--upstream-text-secondary)",
				fillAccent: "var(--upstream-fill-accent)",
				surface1: "var(--upstream-surface-1)",
				surface2: "var(--upstream-surface-2)",
				cursor: "pointer",
				padMd: "8px",
				modified: "var(--upstream-git-modified)",
				selection: "var(--upstream-accent)",
				selectionBg: "var(--upstream-fill-accent)",
				selectionNumberBg: "var(--upstream-fill-accent)",
				fontFeatures: undefined,
			},
		);
	});

	it("defines upstream's --cds-text-git-modified per theme", () =>
	{
		const css = readFileSync(GLOBALS_CSS, "utf8");
		const token = (selector: string) =>
		{
			const start = ruleStart(css, `\n${selector}`);
			return css.slice(start, css.indexOf("\n}", start + 1)).match(/\s--upstream-git-modified:\s*([^;]+);/)?.[1];
		};
		expect(
			{
				light: token(":root"),
				dark: token(".dark"),
			},
		).toStrictEqual(
			{
				light: "#98801f",
				dark: "#ffd014",
			},
		);
	});
});

describe("DIFFS_STYLE_OVERRIDES alt words (upstream ca9e46d28 Q().style)", () =>
{
	it("sets the rails sheet's --diff-word-added / --diff-word-removed", () =>
	{
		expect(
			{
				added: OVERRIDES["--diff-word-added"],
				removed: OVERRIDES["--diff-word-removed"],
			},
		).toStrictEqual(
			{
				added: '"added"',
				removed: '"removed"',
			},
		);
	});
});
