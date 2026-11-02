import {createContext} from "react";

import {type FileTypeIconSetName, iconSetForCodeTheme} from "../lib/file-type-icons";
import {useSettings} from "./settings-context";
import {useResolvedTheme} from "./theme-context";

/**
 * Upstream `I`: the icon set coloured file-type icons draw from. Only the
 * Files and Changes panes provide one; everywhere else it is null and
 * `FileTypeIcon` draws the monochrome glyph.
 */
export const FileTypeIconSetContext = createContext<FileTypeIconSetName | null>(null);

/** Upstream `Z()`: the icon set the code theme for the page's light/dark mode draws. */
export function useActiveFileTypeIconSet(): FileTypeIconSetName | null
{
	const {settings} = useSettings();
	const mode = useResolvedTheme();
	return iconSetForCodeTheme(mode === "dark" ? settings.codeThemeDark : settings.codeThemeLight);
}
