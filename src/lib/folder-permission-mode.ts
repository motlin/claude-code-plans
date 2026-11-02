import {type LaunchPermissionMode, LaunchPermissionModeSchema} from "./launch-options";
import {consentWorkspaceKey} from "./permission-mode-consent";

/*
 * Upstream's per-folder remembered permission mode: cf6ae6197 `Td` keeps `[gt, _t] = On(
 * "epitaxy-folder-permission-mode-v2", {}, {seedFromPref: pd})`, a flat `{[workspaceKey]: mode}` map; ca8b34310 `Ao`
 * resolves a new draft's base mode from it; shared-8 `TL` clamps the result to the modes on offer. Locally the map is
 * per browser (like `cc-landing-worktree-enabled`), and only the local-folder key applies.
 */

export const FOLDER_PERMISSION_MODE_STORAGE_KEY = "epitaxy-folder-permission-mode-v2";

export type FolderModes = Record<string, LaunchPermissionMode>;

/** How a pick was made (upstream's `change_method`). */
export type ModePickMethod =
	| "mode_dropdown"
	| "keyboard_shortcut"
	| "global_shortcut"
	| "slash_command"
	| "manual_confirm_dialog"
	| "auto_gate_demoted"
	| "approval_card";

/** Upstream `qi(Hm(cwd))` for a local folder: the absolute path, a trailing worktree stripped; no cwd gives null. */
export function folderModeKey(cwd: string | undefined): string | null
{
	if (cwd === undefined || cwd === "") return null;
	return consentWorkspaceKey(cwd);
}

export function readFolderModes(): FolderModes
{
	try
	{
		const raw = localStorage.getItem(FOLDER_PERMISSION_MODE_STORAGE_KEY);
		if (raw === null) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const modes: FolderModes = {};
		for (const [key, value] of Object.entries(parsed))
		{
			const mode = LaunchPermissionModeSchema.safeParse(value);
			if (mode.success) modes[key] = mode.data;
		}
		return modes;
	}
	catch
	{
		// Storage can be unavailable (private mode) or hold junk: nothing is remembered.
		return {};
	}
}

function writeFolderModes(modes: FolderModes): void
{
	try
	{
		localStorage.setItem(FOLDER_PERMISSION_MODE_STORAGE_KEY, JSON.stringify(modes));
	}
	catch
	{
		// Storage can be unavailable (private mode); the pick still applies to this draft.
	}
}

export function writeFolderMode(key: string, mode: LaunchPermissionMode): void
{
	writeFolderModes(
		{
			...readFolderModes(),
			[key]: mode,
		},
	);
}

/**
 * Upstream's rollback `x()`: put back the entry from before a failed pick, deleting it when there was none. With
 * `ifStill` (upstream `onlyIfKept`) nothing happens once another pick has replaced the failed one.
 */
export function restoreFolderMode(
	key: string,
	previous: LaunchPermissionMode | undefined,
	ifStill?: LaunchPermissionMode,
): void
{
	const modes = readFolderModes();
	if (ifStill !== undefined && modes[key] !== ifStill) return;
	if (previous === undefined)
	{
		const {[key]: _dropped, ...rest} = modes;
		writeFolderModes(rest);
	}
	else
	{
		writeFolderModes(
			{
				...modes,
				[key]: previous,
			},
		);
	}
}

/** Upstream's commit: Plan is never remembered, and neither is an approval card's switch. */
export function shouldRememberPick({mode, method}: {mode: LaunchPermissionMode; method: ModePickMethod}): boolean
{
	return mode !== "plan" && method !== "approval_card";
}

/** Upstream `Pt`: the folder's remembered mode, with Plan never restored. */
export function folderChoice(modes: FolderModes, key: string | null): LaunchPermissionMode | undefined
{
	if (key === null) return undefined;
	const mode = modes[key];
	return mode === "plan" ? undefined : mode;
}

export type DraftBaseModeSource =
	| "in_session_pick"
	| "settings_default_mode"
	| "folder_pick"
	| "repo_settings_default_mode"
	| "fallback";

/**
 * Upstream `Ao` (without the managed ceiling or the account global pref): a user or managed `defaultMode` beats the
 * folder memory, which beats a project `defaultMode`. Settings defaults stay strings so a mode the menu can't offer
 * (`dontAsk`) still reads as itself.
 */
export function resolveDraftBaseMode({
	userChoice,
	userSettingsDefault,
	folderChoice: folder,
	repoSettingsDefault,
	fallback,
}: {
	userChoice: LaunchPermissionMode | null;
	userSettingsDefault: string | undefined;
	folderChoice: LaunchPermissionMode | undefined;
	repoSettingsDefault: string | undefined;
	fallback: string;
}):
{
	mode: string;
	source: DraftBaseModeSource;
	hasExplicitChoice: boolean;
}
{
	const hasExplicitChoice = userChoice !== null || (userSettingsDefault === undefined && folder !== undefined);
	if (userChoice !== null)
		return {
			mode: userChoice,
			source: "in_session_pick",
			hasExplicitChoice,
		};
	if (userSettingsDefault !== undefined)
	{
		return {
			mode: userSettingsDefault,
			source: "settings_default_mode",
			hasExplicitChoice,
		};
	}
	if (folder !== undefined)
		return {
			mode: folder,
			source: "folder_pick",
			hasExplicitChoice,
		};
	if (repoSettingsDefault !== undefined)
	{
		return {
			mode: repoSettingsDefault,
			source: "repo_settings_default_mode",
			hasExplicitChoice,
		};
	}
	return {
		mode: fallback,
		source: "fallback",
		hasExplicitChoice,
	};
}

/** Upstream `TL`: keep an offered mode; unoffered auto becomes Accept edits; else the first non-auto mode. */
export function clampToAvailable(
	mode: LaunchPermissionMode,
	available: readonly LaunchPermissionMode[],
): LaunchPermissionMode
{
	if (available.includes(mode)) return mode;
	if (mode === "auto" && available.includes("acceptEdits")) return "acceptEdits";
	return available.find((candidate) => candidate !== "auto") ?? available[0] ?? "acceptEdits";
}

/** Upstream's folder switch keeps a pick that needs no consent (`!Lm(pick, {autoIsDefault: false})`). */
export function carryPickToFolder({pick}: {pick: LaunchPermissionMode}): boolean
{
	return pick !== "auto" && pick !== "bypassPermissions";
}

/**
 * A new draft's mode in `cwd`: the user default, else the folder memory, else the project default, else Manual,
 * clamped to the modes on offer. `launchFlag` is set when the CLI, which merges a project `defaultMode` over the
 * user's, wouldn't start in that mode by itself.
 */
export function draftPermissionMode({
	cwd,
	modes,
	userSettingsDefault,
	repoSettingsDefault,
	available,
}: {
	cwd: string | undefined;
	modes: FolderModes;
	userSettingsDefault: string | null;
	repoSettingsDefault: string | null;
	available: readonly LaunchPermissionMode[];
}):
{
	mode: string;
	launchFlag: LaunchPermissionMode | undefined;
}
{
	const base = resolveDraftBaseMode(
		{
			userChoice: null,
			userSettingsDefault: userSettingsDefault ?? undefined,
			folderChoice: folderChoice(modes, folderModeKey(cwd)),
			repoSettingsDefault: repoSettingsDefault ?? undefined,
			fallback: "default",
		},
	);
	const known = LaunchPermissionModeSchema.safeParse(base.mode);
	if (!known.success)
		return {
			mode: base.mode,
			launchFlag: undefined,
		};
	const mode = clampToAvailable(known.data, available);
	const cliOwn = repoSettingsDefault ?? userSettingsDefault ?? "default";
	return {
		mode,
		launchFlag: mode === cliOwn ? undefined : mode,
	};
}
