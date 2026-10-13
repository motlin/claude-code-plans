import {registerCustomTheme} from "@pierre/diffs";
import type {CSSProperties} from "react";
import {claudeLight} from "../../lib/claude-light-theme";

// Register our claude.ai code theme with the library's shared highlighter so
// every @pierre/diffs view (Changes pane, inline tool diffs) highlights with the
// same Shiki themes as the transcript. Importing this module performs it.
registerCustomTheme("claude-light", async () => Promise.resolve(claudeLight));

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
	"--diffs-fg-number-addition-override": "var(--upstream-extended-green)",
	"--diffs-fg-number-deletion-override": "var(--upstream-extended-pink)",
	"--diffs-addition-color-override": "var(--upstream-extended-green)",
	"--diffs-deletion-color-override": "var(--upstream-extended-pink)",
	"--diffs-modified-color-override": "var(--color-git-conflicting)",
	"--diffs-selection-color-override": "var(--accent-100)",
	"--diffs-bg-selection-override": "var(--accent-900)",
	"--diffs-bg-selection-number-override": "var(--accent-900)",
	"--diffs-fg-conflict-marker-override": "var(--upstream-text-muted)",
	"--diffs-gap-style": "0",
	"--diffs-overflow-override": "clip",
	"--diffs-scrollbar-gutter-override": "0px",
} as CSSProperties;
