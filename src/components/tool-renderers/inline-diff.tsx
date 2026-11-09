import {getSingularPatch} from "@pierre/diffs";
import {FileDiff} from "@pierre/diffs/react";
import type {FileDiffOptions} from "@pierre/diffs/react";
import {type CSSProperties, useMemo} from "react";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {buildUnifiedHunk} from "../../lib/diff-utils";
import {railsPostRender} from "../changes/diff-rails";
import {DIFFS_HOST_CLASS, INLINE_DIFFS_STYLE_OVERRIDES, diffsInjectedCss} from "../changes/diffs-config";
import {useFizzyLake} from "../../lib/fizzy-lake";
import {useResolvedTheme} from "../theme-context";

/**
 * A tool call's inline diff, rendered by `@pierre/diffs` like the Changes
 * pane, with upstream's inline options: unified, simple hunk separators,
 * wrapped lines and no file header (the tool card supplies its own).
 */
export function InlineDiff({filePath, oldStr, newStr}: {filePath: string; oldStr: string; newStr: string}) {
	const patch = useMemo(() => buildUnifiedHunk(oldStr, newStr, filePath), [filePath, oldStr, newStr]);
	// Upstream's `epitaxy-diff` hook class carries Settings ▸ Code font size into the diff; the cds FileDiff
	// div (`Va`) inside it carries the host style.
	return (
		<div className="epitaxy-diff">
			<InlinePatchDiff patch={patch} />
		</div>
	);
}

/**
 * The cds FileDiff host (`Va`) drawing one git-style patch with the inline options; `disableLineNumbers`
 * keeps only the sign column (upstream's input-only excerpt), and `hostStyle` adds to the host's style.
 */
export function InlinePatchDiff({
	patch,
	disableLineNumbers = false,
	hostStyle,
}: {
	patch: string;
	disableLineNumbers?: boolean;
	hostStyle?: CSSProperties;
}) {
	const fileDiff = useMemo(() => getSingularPatch(patch), [patch]);
	const resolvedTheme = useResolvedTheme();
	const codeThemes = useCodeThemes();
	const panels = useFizzyLake("panels");

	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
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
			unsafeCSS: diffsInjectedCss({disableFileHeader: true, gutterUtility: false, panels}),
		}),
		[codeThemes, resolvedTheme, panels, disableLineNumbers],
	);
	const style = useMemo(
		() =>
			hostStyle === undefined ? INLINE_DIFFS_STYLE_OVERRIDES : {...INLINE_DIFFS_STYLE_OVERRIDES, ...hostStyle},
		[hostStyle],
	);

	return (
		<div data-cds="FileDiff" dir="ltr" className={DIFFS_HOST_CLASS} style={style}>
			<FileDiff fileDiff={fileDiff} options={options} disableWorkerPool />
		</div>
	);
}
