import type {FileOptions} from "@pierre/diffs/react";
import {File} from "@pierre/diffs/react";
import {type CSSProperties, useMemo} from "react";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {pureSideRailsCss} from "../changes/diff-rails";
import {DIFFS_HOST_CLASS, INLINE_DIFFS_STYLE_OVERRIDES} from "../changes/diffs-config";
import {TOKEN_FONT_CSS} from "../../lib/code-tile";
import {useResolvedTheme} from "../theme-context";

export type PureSide = "additions" | "deletions";

/**
 * Upstream's headerless file sheet: `Fx` (ligatures on, letter-spacing snapped to 1/64px), the token font
 * rules, then the RTL file view's bidi rule.
 */
const FILE_BASE_CSS =
	'[data-file] { letter-spacing: calc(round(up, 1ch, 1px / 64) - 1ch); font-feature-settings: "liga", "clig", "calt"; } [data-line] { min-height: 1lh; } [data-code] { padding-bottom: var(--diffs-gap-block, var(--diffs-gap-fallback)); overflow: clip; } ' +
	TOKEN_FONT_CSS +
	"[data-line] { unicode-bidi: var(--epitaxy-file-line-bidi, revert); }";

/** Upstream's sign glyphs `pc`: a plus, and U+2212 for deletions. */
const SIGN: Record<PureSide, string> =
{
	additions: "+ ",
	deletions: "− ",
};

/** Upstream's `ao`: the sign's ink. */
const SIGN_COLOR = "var(--cds-text-secondary)";

/**
 * Upstream's pure-side tint (`cy`): every line on the side's diff background and the side's sign before each
 * line number (an `excerpt` hides the numbers and keeps only the sign), then `Vd(side)`'s rails and full-row tint.
 */
function pureSideCss(side: PureSide, excerpt: boolean): string
{
	const background = side === "additions" ? "var(--diffs-bg-addition)" : "var(--diffs-bg-deletion)";
	const tint = `[data-line]{background:${background};}[data-line-number-content]::before{content:"${SIGN[side]}";display:inline-block;min-width:1ch;color:${SIGN_COLOR};}`;
	const numbers = excerpt
		? "[data-line-number-content]{visibility:hidden;}[data-line-number-content]::before{visibility:visible;}"
		: "";
	return tint + numbers + pureSideRailsCss(side);
}

/**
 * Upstream sanitises the text to LF line endings and its `s()` makes a final line ending end the last line;
 * local's `File` would draw a leftover `\r` or final newline as one more empty line, so it drops them instead.
 */
function drawnLines(text: string): string
{
	const lf = text.replace(/\r\n/g, "\n");
	return lf.endsWith("\n") || lf.endsWith("\r") ? lf.slice(0, -1) : lf;
}

/**
 * Upstream's pure-side view: one side of a change (a new file's lines, or an edit's removed text) drawn as a
 * headerless, wrapped `File` rather than a diff.
 */
export function PureSideFile({
	path,
	content,
	side,
	excerpt = false,
	hostStyle,
}: {
	path: string;
	content: string;
	side: PureSide;
	excerpt?: boolean;
	hostStyle?: CSSProperties;
})
{
	const themeType = useResolvedTheme();
	const theme = useCodeThemes();
	const file = useMemo(() =>
	{
		const contents = drawnLines(content);
		return {
			name: path.replace(/^.*[\\/]/, ""),
			contents,
			cacheKey: `pure-side:${side}:${path}:${contents}`,
		};
	}, [path, content, side]);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => (
		{
			theme,
			themeType,
			disableFileHeader: true,
			overflow: "wrap",
			unsafeCSS: FILE_BASE_CSS + pureSideCss(side, excerpt),
		}),
		[theme, themeType, side, excerpt],
	);
	const style = useMemo(
		() => (
		{
			...INLINE_DIFFS_STYLE_OVERRIDES,
			// Upstream leaves it unset on the pure host, so the gutter keeps pierre's 2px base border.
			"--diffs-gap-style": undefined,
			...hostStyle,
		}),
		[hostStyle],
	);
	return (
		<div data-cds="FileDiff" dir="ltr" className={DIFFS_HOST_CLASS} style={style}>
			<File file={file} options={options} disableWorkerPool />
		</div>
	);
}
