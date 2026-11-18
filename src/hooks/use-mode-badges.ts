import {useQuery} from "@tanstack/react-query";
import {useMemo} from "react";

import {composerFolderDefaultsQueryOptions} from "../lib/api/composer-defaults";
import {folderChoice, folderModeKey, type FolderModes, modeBadges} from "../lib/folder-permission-mode";
import type {ModeBadgeSettings} from "../lib/launch-options";

/** The Mode menu's Default / Recommended badges for `cwd`, from its settings defaults and remembered folder mode. */
export function useModeBadges(cwd: string | undefined, modes: FolderModes): ModeBadgeSettings | undefined
{
	const {data} = useQuery(composerFolderDefaultsQueryOptions(cwd));
	const folder = folderChoice(modes, folderModeKey(cwd));
	return useMemo(
		() =>
			data === undefined
				? undefined
				: modeBadges(
						{
							userSettingsDefault: data.defaultMode,
							userSettingsDefaultManaged: data.defaultModeManaged,
							folderChoice: folder,
							repoSettingsDefault: data.repoDefaultMode,
						},
					),
		[data, folder],
	);
}
