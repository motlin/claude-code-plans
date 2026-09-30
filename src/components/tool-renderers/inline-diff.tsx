import {getSingularPatch} from "@pierre/diffs";
import {FileDiff} from "@pierre/diffs/react";
import type {FileDiffOptions} from "@pierre/diffs/react";
import {useMemo} from "react";
import {useCodeThemes} from "../../hooks/use-code-themes";
import {buildUnifiedHunk} from "../../lib/diff-utils";
import {DIFFS_STYLE_OVERRIDES} from "../changes/diff-file";
import {useResolvedTheme} from "../theme-provider";

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

	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
			theme: codeThemes,
			themeType: resolvedTheme,
			diffStyle: "unified",
			diffIndicators: "classic",
			overflow: "wrap",
			hunkSeparators: "simple",
			disableFileHeader: true,
		}),
		[codeThemes, resolvedTheme],
	);

	return <FileDiff fileDiff={fileDiff} options={options} style={DIFFS_STYLE_OVERRIDES} disableWorkerPool />;
}
