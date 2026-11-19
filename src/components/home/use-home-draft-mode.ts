import {useQuery} from "@tanstack/react-query";
import {useMemo} from "react";

import {useFolderModeMemory, type FolderModeMemory} from "../../hooks/use-folder-mode-memory";
import {composerDefaultsQueryOptions, composerFolderDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import type {ComposerDefaults} from "../../lib/composer-state";
import {clampToAvailable, draftPermissionMode} from "../../lib/folder-permission-mode";
import
{
	autoModeLockNote,
	type LaunchOptions,
	type LaunchPermissionMode,
	offeredModes,
	resolveLaunchModel,
} from "../../lib/launch-options";

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
	/** Why the draft's model can't run Auto (`autoModeLockNote`), or null. */
	autoLockNote: string | null;
	/** The modes the draft may start in, without Auto while `autoLockNote` is set. */
	available: LaunchPermissionMode[];
	/** The mode the chin shows: the chin's pick (clamped like the base mode), else `draftMode.mode`. */
	effectiveMode: string;
}

/**
 * The home draft's base permission mode in `cwd` (the folder memory, the user and project settings defaults), which
 * the chin shows until a pick and the start card's auto-mode row reads. Upstream gates Auto on the draft's model (the chin's `picks.model`, else the
 * one settings launch): one that can't run Auto clamps an Auto mode to Accept edits, its derived `TL` demotion. The
 * stored pick keeps Auto, so a model that runs Auto brings it back.
 */
export function useHomeDraftMode(
	cwd: string | undefined,
	picks: Pick<LaunchOptions, "model" | "permissionMode"> = {},
): HomeDraftMode
{
	const {data: defaults} = useQuery(composerDefaultsQueryOptions);
	const folderModes = useFolderModeMemory(cwd);
	const {data: folderDefaults} = useQuery(composerFolderDefaultsQueryOptions(cwd));
	const bypassPermissionsAllowed = defaults?.bypassPermissionsAllowed ?? false;
	// The folder read also weighs the project layers' `disableAutoMode`, so it's the closer answer once it loads.
	const cliFallbackMode = folderDefaults?.cliFallbackMode ?? defaults?.cliFallbackMode ?? "default";
	const autoLockNote = autoModeLockNote(picks.model ?? resolveLaunchModel(defaults?.model ?? null));
	const available = useMemo(
		() => offeredModes(bypassPermissionsAllowed, autoLockNote),
		[bypassPermissionsAllowed, autoLockNote],
	);
	const draftMode = useMemo(
		() =>
			draftPermissionMode(
				{
					cwd,
					modes: folderModes.modes,
					userSettingsDefault: defaults?.defaultMode ?? null,
					repoSettingsDefault: folderDefaults?.repoDefaultMode ?? null,
					cliFallbackMode,
					available,
				},
			),
		[cwd, folderModes.modes, defaults?.defaultMode, folderDefaults?.repoDefaultMode, cliFallbackMode, available],
	);
	return {
		draftMode,
		folderModes,
		defaults,
		folderDefaults,
		bypassPermissionsAllowed,
		settled: defaults !== undefined && folderDefaults !== undefined,
		autoLockNote,
		available,
		effectiveMode:
			picks.permissionMode === undefined
				? draftMode.mode
				: autoLockNote === null
					? picks.permissionMode
					: clampToAvailable(picks.permissionMode, available),
	};
}
