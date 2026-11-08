import {getSingularPatch} from "@pierre/diffs";
import {FileDiff} from "@pierre/diffs/react";
import type {FileDiffOptions} from "@pierre/diffs/react";
import {useMemo} from "react";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {buildUnifiedHunk} from "../../lib/diff-utils";
import {DIFFS_HOST_CLASS, INLINE_DIFFS_STYLE_OVERRIDES, diffsInjectedCss} from "../changes/diffs-config";
import {useFizzyLake} from "../../lib/fizzy-lake";
import {useResolvedTheme} from "../theme-context";

/**
 * A tool call's inline diff, rendered by `@pierre/diffs` like the Changes
 * pane, with upstream's inline options: unified, simple hunk separators,
 * wrapped lines and no file header (the tool card supplies its own).
 */
export function InlineDiff({filePath, oldStr, newStr}: {filePath: string; oldStr: string; newStr: string}) {
	const fileDiff = useMemo(
		() => getSingularPatch(buildUnifiedHunk(oldStr, newStr, filePath)),
		[filePath, oldStr, newStr],
	);
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
			unsafeCSS: diffsInjectedCss({disableFileHeader: true, gutterUtility: false, panels}),
		}),
		[codeThemes, resolvedTheme, panels],
	);

	// Upstream's `epitaxy-diff` hook class carries Settings ▸ Code font size into the diff; the cds FileDiff
	// div (`Va`) inside it carries the host style.
	return (
		<div className="epitaxy-diff">
			<div data-cds="FileDiff" dir="ltr" className={DIFFS_HOST_CLASS} style={INLINE_DIFFS_STYLE_OVERRIDES}>
				<FileDiff fileDiff={fileDiff} options={options} disableWorkerPool />
			</div>
		</div>
	);
}
