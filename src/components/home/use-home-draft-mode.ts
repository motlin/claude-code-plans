import {useQuery} from "@tanstack/react-query";
import {useMemo} from "react";

import {useFolderModeMemory, type FolderModeMemory} from "../../hooks/use-folder-mode-memory";
import {composerDefaultsQueryOptions, composerFolderDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import type {ComposerDefaults} from "../../lib/composer-state";
import {draftPermissionMode} from "../../lib/folder-permission-mode";
import {modeMenuItems} from "../../lib/launch-options";

export interface HomeDraftMode
{
	/** The draft's base mode before a chin pick, and the flag the launch needs for it. */
	draftMode: ReturnType<typeof draftPermissionMode>;
	folderModes: FolderModeMemory;
	defaults: ComposerDefaults | undefined;
	folderDefaults: ComposerDefaults | undefined;
	bypassPermissionsAllowed: boolean;
	/** Both settings reads have loaded (upstream's `permission.settled`). */
	settled: boolean;
}

/**
 * The home draft's base permission mode in `cwd` (the folder memory, the user and project settings defaults), which
 * the chin shows until a pick and the start card's auto-mode row reads.
 */
export function useHomeDraftMode(cwd: string | undefined): HomeDraftMode
{
	const {data: defaults} = useQuery(composerDefaultsQueryOptions);
	const folderModes = useFolderModeMemory(cwd);
	const {data: folderDefaults} = useQuery(composerFolderDefaultsQueryOptions(cwd));
	const bypassPermissionsAllowed = defaults?.bypassPermissionsAllowed ?? false;
	// The folder read also weighs the project layers' `disableAutoMode`, so it's the closer answer once it loads.
	const cliFallbackMode = folderDefaults?.cliFallbackMode ?? defaults?.cliFallbackMode ?? "default";
	const draftMode = useMemo(
		() =>
			draftPermissionMode(
				{
					cwd,
					modes: folderModes.modes,
					userSettingsDefault: defaults?.defaultMode ?? null,
					repoSettingsDefault: folderDefaults?.repoDefaultMode ?? null,
					cliFallbackMode,
					available: modeMenuItems(bypassPermissionsAllowed).map((item) => item.id),
				},
			),
		[
			cwd,
			folderModes.modes,
			defaults?.defaultMode,
			folderDefaults?.repoDefaultMode,
			cliFallbackMode,
			bypassPermissionsAllowed,
		],
	);
	return {
		draftMode,
		folderModes,
		defaults,
		folderDefaults,
		bypassPermissionsAllowed,
		settled: defaults !== undefined && folderDefaults !== undefined,
	};
}
