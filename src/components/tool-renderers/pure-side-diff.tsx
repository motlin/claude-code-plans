import type {FileOptions} from "@pierre/diffs/react";
import {File} from "@pierre/diffs/react";
import {type CSSProperties, useMemo} from "react";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {DIFFS_HOST_CLASS, INLINE_DIFFS_STYLE_OVERRIDES} from "../changes/diffs-config";
import {useResolvedTheme} from "../theme-context";

export type PureSide = "additions" | "deletions";

/** Upstream's `Fx`: the headerless file's base sheet. */
const FILE_BASE_CSS =
	"[data-line]{min-height:1lh} [data-code]{padding-bottom:var(--diffs-gap-block, var(--diffs-gap-fallback));overflow:clip}";

/** Upstream's sign glyphs `pc`: a plus, and U+2212 for deletions. */
const SIGN: Record<PureSide, string> =
{
	additions: "+ ",
	deletions: "− ",
};

/** Upstream's `--cds-bg-git-added` / `--cds-bg-git-removed`: the side's git ink at 20%. */
const PURE_SIDE_TINT: Record<PureSide, string> =
{
	additions: "color-mix(in srgb, var(--upstream-git-added) 20%, transparent)",
	deletions: "color-mix(in srgb, var(--upstream-git-removed) 20%, transparent)",
};

/** Upstream's `ho`: the sign's ink in the transcript. */
const TRANSCRIPT_SIGN_COLOR = "var(--cds-text-secondary)";

/**
 * Upstream's pure-side tint (`ES`/`QS`): every line on the side's diff background and the side's sign before
 * each line number; an `excerpt` hides the numbers and keeps only the sign.
 */
function pureSideCss(side: PureSide, excerpt: boolean, signColor: string): string
{
	const background = side === "additions" ? "var(--diffs-bg-addition)" : "var(--diffs-bg-deletion)";
	const tint = `[data-line]{background:${background};}[data-line-number-content]::before{content:"${SIGN[side]}";display:inline-block;min-width:1ch;color:${signColor};}`;
	return excerpt
		? `${tint}[data-line-number-content]{visibility:hidden;}[data-line-number-content]::before{visibility:visible;}`
		: tint;
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
	signColor = TRANSCRIPT_SIGN_COLOR,
	hostStyle,
}: {
	path: string;
	content: string;
	side: PureSide;
	excerpt?: boolean;
	signColor?: string;
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
			unsafeCSS: FILE_BASE_CSS + pureSideCss(side, excerpt, signColor),
		}),
		[theme, themeType, side, excerpt, signColor],
	);
	const style = useMemo(
		() => (
		{
			...INLINE_DIFFS_STYLE_OVERRIDES,
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

/** Upstream's transcript `ES`: the pure-side file on its side's git tint. */
export function TintedPureSideFile({
	path,
	content,
	side,
	excerpt,
}: {
	path: string;
	content: string;
	side: PureSide;
	excerpt: boolean;
})
{
	return (
		<div
			data-pure-side={side}
			style={
			{
				background: PURE_SIDE_TINT[side],
			}}
		>
			<PureSideFile path={path} content={content} side={side} excerpt={excerpt} />
		</div>
	);
}
