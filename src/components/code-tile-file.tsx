import type {FileOptions} from "@pierre/diffs/react";
import {File} from "@pierre/diffs/react";
import {useMemo} from "react";

import {useCodeThemes} from "../hooks/use-code-themes";
import {CODE_TILE_CSS, normalizeTileCode} from "../lib/code-tile";
import {tileLanguage} from "../lib/code-tile-language";
import {useResolvedTheme} from "./theme-context";

/** The code tile's pierre `File` (upstream `el`'s `Qa`), loaded lazily by `CodeTile`. */
export function CodeTileFile({code, lang}: {code: string; lang: string}) {
	const themeType = useResolvedTheme();
	const theme = useCodeThemes();
	const language = tileLanguage(lang);
	const file = useMemo(
		() => ({
			name: "cmd",
			contents: normalizeTileCode(code),
			lang: language,
			cacheKey: `bashtool:${language}:${code}`,
		}),
		[code, language],
	);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => ({
			theme,
			themeType,
			disableFileHeader: true,
			disableLineNumbers: true,
			overflow: "wrap",
			unsafeCSS: CODE_TILE_CSS,
		}),
		[theme, themeType],
	);
	return <File file={file} options={options} disableWorkerPool />;
}
