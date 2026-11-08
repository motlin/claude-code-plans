import {DEFAULT_VIRTUAL_FILE_METRICS, registerCustomTheme} from "@pierre/diffs";
import type {VirtualFileMetrics} from "@pierre/diffs";
import type {CSSProperties} from "react";
import {claudeDark} from "../../lib/claude-dark-theme";
import {claudeLight} from "../../lib/claude-light-theme";
import {type CodeFontSize, codeRowLeadingPx, loadCodeTheme} from "../../lib/code-themes";
import type {Density} from "../ui/density-context";
import {DIFF_WORD_STYLE} from "./diff-rails";

// Register our claude.ai code themes with the library's shared highlighter so
// every @pierre/diffs view (Changes pane, inline tool diffs) highlights with the
// same Shiki themes as the transcript. Importing this module performs it. The
// VS Code pair isn't bundled with Shiki either, so it loads on first use.
registerCustomTheme("claude-light", async () => Promise.resolve(claudeLight));
registerCustomTheme("claude-dark", async () => Promise.resolve(claudeDark));
registerCustomTheme("vscode-light", async () => loadCodeTheme("vscode-light"));
registerCustomTheme("vscode-dark", async () => loadCodeTheme("vscode-dark"));

/**
 * The `--diffs-*` variables upstream's Changes pane sets on its CodeView (ca7ba268c `_a`/`va`),
 * remapped from `--cds-*` onto our upstream tokens, plus the `--cds-*` names the injected strings
 * below read. Custom properties inherit through the `<diffs-container>` shadow boundary, so setting
 * them on the host reaches both the library's stylesheet and the `@layer unsafe` block.
 */
export const DIFFS_STYLE_OVERRIDES = {
	"--diffs-font-family": "var(--font-mono)",
	"--diffs-header-font-family": "var(--font-sans)",
	"--diffs-font-size": "var(--upstream-text-code)",
	"--diffs-line-height": "var(--upstream-leading-code)",
	"--diffs-bg-hover-override": "var(--upstream-fill-ghost-hover)",
	"--diffs-bg-context-override": "transparent",
	"--diffs-bg-separator-override": "transparent",
	"--diffs-fg-number-override": "var(--upstream-text-muted)",
	"--diffs-fg-number-addition-override": "var(--upstream-git-added)",
	"--diffs-fg-number-deletion-override": "var(--upstream-git-removed)",
	"--diffs-addition-color-override": "var(--upstream-git-added)",
	"--diffs-deletion-color-override": "var(--upstream-git-removed)",
	"--diffs-modified-color-override": "var(--upstream-git-modified)",
	"--diffs-selection-color-override": "var(--upstream-accent)",
	"--diffs-bg-selection-override": "var(--upstream-fill-accent)",
	"--diffs-bg-selection-number-override": "var(--upstream-fill-accent)",
	"--diffs-fg-conflict-marker-override": "var(--upstream-text-muted)",
	"--diffs-gap-style": "0",
	// The `--cds-*` names the injected strings read inside the shadow root (wa, Ea, Ma, Fa, Ta).
	"--cds-text-secondary": "var(--upstream-text-secondary)",
	"--cds-fill-accent": "var(--upstream-fill-accent)",
	"--cds-surface-1": "var(--upstream-surface-1)",
	"--cds-surface-2": "var(--upstream-surface-2)",
	// Upstream's `.cds-root` cursor token (`default` only under the desktop app's [data-platform=desktop]).
	"--cds-cursor-interactive": "pointer",
	// Upstream's comfortable --cds-pad-md.
	"--cds-pad-md": "8px",
	// Upstream ca9e46d28 Q().style: the rails sheet's alt words for the hidden +/− glyphs.
	...DIFF_WORD_STYLE,
} as CSSProperties;

/*
 * Upstream ca7ba268c `za()` injects these into every cds FileDiff/CodeView shadow root (pierre wraps
 * `unsafeCSS` in `@layer unsafe`), verbatim. The minified names are upstream's (`Sa`, `Ca`, `wa`, ...).
 * `xa` (wrap at 80/100/120 columns) is left out: local has no wrap-column setting.
 */
/** `Sa`: the header is disabled; keep the top gap. */
export const SA =
	"[data-diffs-header]{display:none}:is([data-diffs-header]~[data-diff],[data-diffs-header]~[data-file]) [data-code],[data-diff-type=split][data-overflow=wrap]:is([data-diffs-header]~[data-diff]){padding-top:var(--diffs-gap-block,var(--diffs-gap-fallback))}";
/** `Ca`: the gutter utility slot sits at the number column's left edge. */
export const CA =
	":is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-gutter-utility-slot]{right:unset;left:5px;justify-content:flex-start}:is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-column-number]{padding-left:calc(2ch + 5px)}";
/** `wa`: the compact hunk separator (16px expand buttons, hover ink). */
export const WA =
	"[data-separator-wrapper]{padding-left:8px;grid-template-columns:16px auto;column-gap:4px}[data-separator-wrapper][data-separator-multi-button]{grid-template-columns:16px 16px auto}[data-expand-button]{min-width:16px;border-right:0}[data-separator-content]{grid-column-start:-2;padding:0}[data-separator-wrapper]:has([data-expand-button]):hover :is([data-expand-button],[data-separator-content]){color:var(--cds-text-secondary)}";
/** `Ta`: the panels separator padding. */
export const TA =
	"[data-separator-wrapper]{padding-left:var(--cds-pad-md)}@media (pointer:fine){[data-separator-wrapper][data-separator-multi-button]{grid-template-columns:16px calc(24px - var(--cds-pad-md)) auto}}";
/** `Ea`: the diff background comes from the host's `--cds-filediff-bg`. */
export const EA = ":host{--diffs-bg:var(--cds-filediff-bg,var(--cds-surface-1))}";
/** `Da`: selected line numbers mix from the selection override, not modified-yellow. */
export const DA = ":host{--diffs-selection-base:var(--diffs-selection-color-override,var(--diffs-modified-base))}";
/** `Oa`: empty wrapped lines keep one line of height. */
export const OA = "[data-overflow=wrap] [data-line]{min-height:1lh}";
/** `ka`: the code column can shrink below its min-content in wrap mode. */
export const KA = "[data-overflow=wrap]{--diffs-code-grid:var(--diffs-grid-number-column-width) minmax(0,1fr)}";
/** `Aa`: snap the advance to 1/64px; ligatures on unless `--diffs-font-features` is set. */
export const AA =
	'[data-diff],[data-file]{letter-spacing:calc(round(up,1ch,1px/64) - 1ch);font-feature-settings:var(--diffs-font-features,"liga","clig","calt")}';
/** `ja`: bold theme tokens don't inherit the variable font's wght axis. */
export const JA = '[data-line] span[style*="font-weight"],[data-error-message]{font-variation-settings:normal}';
/** `Ma`: text selection inside the shadow root. */
export const MA =
	"::selection{background-color:var(--cds-code-text-selection-bg,light-dark(color-mix(in srgb,var(--cds-fill-accent) 25%,transparent),color-mix(in srgb,var(--cds-fill-accent) 30%,transparent)))}";
/** `Na`: the number column is at least 3ch. */
export const NA =
	":is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-line-number-content],:is([data-diff],[data-file]):not([data-disable-line-numbers]) [data-gutter-buffer]:before{min-width:var(--diffs-min-number-column-width,max(3ch,var(--diffs-min-number-column-width-default,3ch)))}";
/** `Pa`: the "No newline" row lines up with classic `+`/`-`. */
export const PA = '[data-indicators="classic"] [data-no-newline]{padding-inline-start:2ch}';
/** `Fa`: interactive parts take the cursor token. */
export const FA =
	"[data-interactive-line-numbers] [data-column-number],[data-interactive-lines] [data-line],[data-expand-button],[data-expand-index] [data-separator-content],[data-utility-button],[data-merge-conflict-action]{cursor:var(--cds-cursor-interactive)}";

/** Upstream's cds FileDiff wrapper classes (ca7ba268c `Va`). */
export const DIFFS_HOST_CLASS = "text-code text-primary font-normal";

/** Upstream za()'s `injectedCSS`: `[xa,Sa,Ca,wa,Ta,Ea,Da,Oa,ka,Aa,ja,Ma,Na,Pa,Fa].filter(defined).join("")`. */
export function diffsInjectedCss({
	disableFileHeader,
	gutterUtility,
	panels,
}: {
	disableFileHeader: boolean;
	gutterUtility: boolean;
	panels: boolean;
}): string {
	return [
		disableFileHeader ? SA : "",
		gutterUtility ? CA : "",
		WA,
		panels ? TA : "",
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
	].join("");
}

const NAMED_SURFACES = new Set([
	"surface-0",
	"surface-1",
	"surface-2",
	"surface-3",
	"surface-panel",
	"surface-popover",
]);

/** Upstream ca7ba268c `La`: a caller's backgroundColor as the host's `--cds-filediff-bg`. */
export function filediffBg(backgroundColor: string | undefined): string {
	if (backgroundColor === undefined) return "var(--cds-surface-1)";
	if (backgroundColor === "transparent") return "transparent";
	return NAMED_SURFACES.has(backgroundColor) ? `var(--cds-${backgroundColor})` : backgroundColor;
}

/**
 * Upstream sets these only in wrap mode (ca7ba268c za(): `n==="wrap"&&{…}`).
 * Scroll mode leaves them unset so `[data-code]` keeps `overflow: scroll clip`
 * and long lines stay reachable.
 */
export const DIFFS_WRAP_STYLE = {
	"--diffs-overflow-override": "clip",
	"--diffs-scrollbar-gutter-override": "0px",
} as CSSProperties;

/**
 * Upstream's transcript diffs, always wrapped, on the default surface-1 background (no backgroundColor). Upstream `_a` keeps `--diffs-line-height: var(--cds-leading-code)`
 * unless the caller passes metrics.lineHeight (ca7ba268c za), so rows follow the scope density (17/12 compact,
 * 19/13 comfortable); `--code-size` / `--code-leading` carry Settings ▸ Code font size inside the hook classes.
 */
export const INLINE_DIFFS_STYLE_OVERRIDES = {
	...DIFFS_STYLE_OVERRIDES,
	...DIFFS_WRAP_STYLE,
	"--cds-filediff-bg": filediffBg(undefined),
	"--diffs-font-size": "var(--code-size, var(--upstream-text-code))",
	"--diffs-line-height": "var(--code-leading, var(--upstream-leading-code))",
} as CSSProperties;

/** Upstream ca7ba268c `ga`: the code leading per cds density, the JS twin of `--cds-leading-code`. */
export const DIFF_DENSITY_LINE_HEIGHT = {compact: 17, comfortable: 19} as const;

/** Pierre's virtual file metrics (`{hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 44, spacing: 8}`). */
export const DEFAULT_DIFF_METRICS: Readonly<VirtualFileMetrics> = DEFAULT_VIRTUAL_FILE_METRICS;

/**
 * Upstream ca7ba268c `ya`/`za`: pierre's defaults with the density's leading, the caller's metrics on top,
 * and a disabled header zeroed with `spacing` as the top padding. Local has no rem scale, so `rootPx/16` is 1.
 * Pierre reads these only for a FileDiff under a `Virtualizer`.
 */
export function diffMetrics({
	density,
	metrics,
	disableFileHeader = false,
}: {
	density: Density;
	metrics?: Partial<VirtualFileMetrics>;
	disableFileHeader?: boolean;
}): VirtualFileMetrics {
	const merged: VirtualFileMetrics = {
		...DEFAULT_DIFF_METRICS,
		lineHeight: DIFF_DENSITY_LINE_HEIGHT[density],
		...metrics,
	};
	if (!disableFileHeader) return merged;
	const headerless: VirtualFileMetrics = {...merged, diffHeaderHeight: 0};
	headerless.paddingTop = merged.paddingTop ?? merged.spacing;
	return headerless;
}

/** Upstream za: only a caller's lineHeight writes the inline `--diffs-line-height`; otherwise the token stays. */
export function diffLineHeightStyle(metrics: Partial<VirtualFileMetrics> | undefined): CSSProperties {
	return metrics?.lineHeight === undefined ? {} : {"--diffs-line-height": `${metrics.lineHeight}px`};
}

/**
 * Upstream c82eca2bd `c()` for the Changes pane: comfortable defaults whatever the scope density,
 * ×1.5 rows from Settings ▸ Code font size, and the 32px custom header (c44d00c7f).
 */
export function changesDiffMetrics(size: CodeFontSize | null): VirtualFileMetrics {
	return diffMetrics({density: "comfortable", metrics: {lineHeight: codeRowLeadingPx(size), diffHeaderHeight: 32}});
}
