import {DEFAULT_VIRTUAL_FILE_METRICS, registerCustomTheme} from "@pierre/diffs";
import type {VirtualFileMetrics} from "@pierre/diffs";
import type {CSSProperties} from "react";
import {claudeDark} from "../../lib/claude-dark-theme";
import {claudeLight} from "../../lib/claude-light-theme";
import {type CodeFontSize, codeRowLeadingPx, loadCodeTheme} from "../../lib/code-themes";
import type {Density} from "../ui/density-context";

// Register our claude.ai code themes with the library's shared highlighter so
// every @pierre/diffs view (Changes pane, inline tool diffs) highlights with the
// same Shiki themes as the transcript. Importing this module performs it. The
// VS Code pair isn't bundled with Shiki either, so it loads on first use.
registerCustomTheme("claude-light", async () => Promise.resolve(claudeLight));
registerCustomTheme("claude-dark", async () => Promise.resolve(claudeDark));
registerCustomTheme("vscode-light", async () => loadCodeTheme("vscode-light"));
registerCustomTheme("vscode-dark", async () => loadCodeTheme("vscode-dark"));

/**
 * The `--diffs-*` variables upstream's Changes pane sets on its CodeView,
 * remapped from `--cds-*` onto our upstream tokens. Custom properties inherit
 * through the `<diffs-container>` shadow boundary, so setting them on the host
 * reaches the library's internal stylesheet.
 */
export const DIFFS_STYLE_OVERRIDES = {
	"--diffs-font-family": "var(--font-mono)",
	"--diffs-font-features": '"liga" 0, "calt" 0',
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
	"--diffs-modified-color-override": "var(--color-git-conflicting)",
	"--diffs-selection-color-override": "var(--accent-100)",
	"--diffs-bg-selection-override": "var(--accent-900)",
	"--diffs-bg-selection-number-override": "var(--accent-900)",
	"--diffs-fg-conflict-marker-override": "var(--upstream-text-muted)",
	"--diffs-gap-style": "0",
	// Upstream's comfortable --cds-pad-md, which the injected separator CSS reads inside the shadow root.
	"--cds-pad-md": "8px",
} as CSSProperties;

/*
 * Upstream ca7ba268c CodeView `za()` injects `Ta` into every diff shadow root while panels is on.
 * It goes after upstream's always-on `wa` list, which local does not inject yet
 * (upstream-sync diff-codeview-injected-css); until then `Ta` stands alone.
 */
const PANELS_SEPARATOR_CSS =
	"[data-separator-wrapper]{padding-left:var(--cds-pad-md)}@media (pointer:fine){[data-separator-wrapper][data-separator-multi-button]{grid-template-columns:16px calc(24px - var(--cds-pad-md)) auto}}";

/** The `unsafeCSS` upstream's CodeView injects for the given fizzy-lake state. */
export function diffsUnsafeCss({panels}: {panels: boolean}): string {
	return panels ? PANELS_SEPARATOR_CSS : "";
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
 * Upstream's transcript diffs, always wrapped. Upstream `_a` keeps `--diffs-line-height: var(--cds-leading-code)`
 * unless the caller passes metrics.lineHeight (ca7ba268c za), so rows follow the scope density (17/12 compact,
 * 19/13 comfortable); `--code-size` / `--code-leading` carry Settings ▸ Code font size inside the hook classes.
 */
export const INLINE_DIFFS_STYLE_OVERRIDES = {
	...DIFFS_STYLE_OVERRIDES,
	...DIFFS_WRAP_STYLE,
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
