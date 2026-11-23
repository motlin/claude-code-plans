import {type FileDiffMetadata, getSingularPatch} from "@pierre/diffs";
import {FileDiff} from "@pierre/diffs/react";
import type {FileDiffOptions} from "@pierre/diffs/react";
import {type CSSProperties, useMemo} from "react";
import {useCodeThemes} from "../../hooks/use-code-themes";
import type {CodeThemeId} from "../../lib/code-themes";
import {buildPatchFromHunks, buildUnifiedHunk, type PatchHunk} from "../../lib/diff-utils";
import {railsPostRender} from "../changes/diff-rails";
import {DIFFS_HOST_CLASS, INLINE_DIFFS_STYLE_OVERRIDES, diffsInjectedCss} from "../changes/diffs-config";
import {useResolvedTheme} from "../theme-context";
import {type PureSide, TintedPureSideFile} from "./pure-side-diff";

type InlineDiffView =
	|
	  {
			kind: "diff";
			fileDiff: FileDiffMetadata;
			numbered: boolean;
	  }
	|
	  {
			kind: "pure";
			side: PureSide;
			content: string;
	  };

/** Upstream's `h()`: the result's hunks as a parsed diff, or null when parsing fails or loses a hunk. */
function sidecarDiff(patch: readonly PatchHunk[], name: string): FileDiffMetadata | null
{
	const hunks = patch.map((hunk) => (
	{
		...hunk,
		lines: hunk.lines.filter((line) => !line.startsWith("\\")),
	}));
	try
	{
		const fileDiff = getSingularPatch(buildPatchFromHunks(hunks, name).patch);
		return fileDiff.hunks.length === patch.length ? fileDiff : null;
	}
	catch
	{
		return null;
	}
}

/** Upstream's `s()` then line split: a final newline ends the last line rather than starting another. */
function trimFinalNewline(text: string): string
{
	return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * Upstream's diff meta `S`: the result's real hunks, numbered, when it reports this call's change; else one
 * side alone when the other is empty; else the input's old → new diff with the numbers off.
 */
function inlineDiffView(
	name: string,
	oldStr: string,
	newStr: string,
	patch: readonly PatchHunk[] | undefined,
): InlineDiffView
{
	const fileName = name.replace(/^.*[\\/]/, "");
	const sidecar = patch === undefined ? null : sidecarDiff(patch, fileName);
	if (sidecar !== null)
		return {
			kind: "diff",
			fileDiff: sidecar,
			numbered: true,
		};
	if (oldStr === "")
		return {
			kind: "pure",
			side: "additions",
			content: newStr,
		};
	if (newStr === "")
		return {
			kind: "pure",
			side: "deletions",
			content: oldStr,
		};
	return {
		kind: "diff",
		fileDiff: getSingularPatch(buildUnifiedHunk(trimFinalNewline(oldStr), trimFinalNewline(newStr), fileName)),
		numbered: false,
	};
}

/**
 * A tool call's inline diff, rendered by `@pierre/diffs` like the Changes
 * pane, with upstream's inline options: unified, simple hunk separators,
 * wrapped lines and no file header (the tool card supplies its own).
 *
 * With the result's `patch` it draws the real hunks with the file's line
 * numbers; without one it diffs the input's strings with the numbers off, or
 * shows a lone side as upstream's pure-side view (`excerpt` hides its numbers).
 */
export function InlineDiff({
	filePath,
	oldStr,
	newStr,
	patch,
	excerpt = true,
}: {
	filePath: string;
	oldStr: string;
	newStr: string;
	patch?: readonly PatchHunk[] | undefined;
	excerpt?: boolean;
})
{
	const view = useMemo(() => inlineDiffView(filePath, oldStr, newStr, patch), [filePath, oldStr, newStr, patch]);
	if (view.kind === "pure")
	{
		return <TintedPureSideFile path={filePath} content={view.content} side={view.side} excerpt={excerpt} />;
	}
	// Upstream's `epitaxy-diff` hook class carries Settings ▸ Code font size into the diff; the cds FileDiff
	// div (`Va`) inside it carries the host style.
	return (
		<div className="epitaxy-diff">
			<InlineFileDiff fileDiff={view.fileDiff} disableLineNumbers={!view.numbered} />
		</div>
	);
}

/**
 * The cds FileDiff host (`Va`) drawing one git-style patch with the inline options; `disableLineNumbers`
 * keeps only the sign column (upstream's input-only excerpt), `hostStyle` adds to the host's style, and
 * `theme` draws it in that one code theme instead of the Settings pair (the code-theme preview).
 */
export function InlinePatchDiff({
	patch,
	disableLineNumbers = false,
	hostStyle,
	theme,
}: {
	patch: string;
	disableLineNumbers?: boolean;
	hostStyle?: CSSProperties;
	theme?: CodeThemeId;
})
{
	const fileDiff = useMemo(() => getSingularPatch(patch), [patch]);
	return (
		<InlineFileDiff
			fileDiff={fileDiff}
			disableLineNumbers={disableLineNumbers}
			hostStyle={hostStyle}
			theme={theme}
		/>
	);
}

function InlineFileDiff({
	fileDiff,
	disableLineNumbers,
	hostStyle,
	theme,
}: {
	fileDiff: FileDiffMetadata;
	disableLineNumbers: boolean;
	hostStyle?: CSSProperties | undefined;
	theme?: CodeThemeId | undefined;
})
{
	const resolvedTheme = useResolvedTheme();
	const settingsThemes = useCodeThemes();
	const codeThemes = theme ?? settingsThemes;

	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => (
		{
			theme: codeThemes,
			themeType: resolvedTheme,
			diffStyle: "unified",
			diffIndicators: "classic",
			overflow: "wrap",
			hunkSeparators: "simple",
			disableFileHeader: true,
			disableLineNumbers,
			// Upstream c81f2e888 ne() = Q(true, false): rails, never the add button.
			onPostRender: railsPostRender(false),
			unsafeCSS: diffsInjectedCss(
				{
					disableFileHeader: true,
					gutterUtility: false,
				},
			),
		}),
		[codeThemes, resolvedTheme, disableLineNumbers],
	);
	const style = useMemo(
		() =>
			hostStyle === undefined
				? INLINE_DIFFS_STYLE_OVERRIDES
				:
					{
						...INLINE_DIFFS_STYLE_OVERRIDES,
						...hostStyle,
					},
		[hostStyle],
	);

	return (
		<div data-cds="FileDiff" dir="ltr" className={DIFFS_HOST_CLASS} style={style}>
			<FileDiff fileDiff={fileDiff} options={options} disableWorkerPool />
		</div>
	);
}
