import type {CSSProperties} from "react";
import {CODE_THEME_BG_FALLBACK} from "../../hooks/use-code-theme-background";
import type {PaneKind} from "../../lib/pane-layout";

/** Upstream c03935b01 `vc` ({diff: "editor", file: "editor", terminal: "terminal"}): the tiles drawn on the code theme. */
const CODE_SURFACE_KINDS: ReadonlySet<PaneKind> = new Set<PaneKind>(["files", "changes", "terminal"]);

/**
 * Upstream c4db265df pane shell `kt` with `codeSurface`: the tile sits on the code theme's background (falling back
 * to surface-2) and hands that background to the transcript content inside as `--epitaxy-transcript-surface`, so
 * fence rings composite over the editor colour. Until `--code-theme-bg` is published the variable is invalid and
 * consumers fall back to surface-1, as upstream's do.
 */
const CODE_SURFACE_STYLE =
{
	background: CODE_THEME_BG_FALLBACK,
	"--epitaxy-transcript-surface": "var(--code-theme-bg)",
} as const satisfies CSSProperties & Record<`--${string}`, string>;

export function codeSurfaceStyle(kind: PaneKind): typeof CODE_SURFACE_STYLE | undefined
{
	return CODE_SURFACE_KINDS.has(kind) ? CODE_SURFACE_STYLE : undefined;
}
