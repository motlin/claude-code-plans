import {useQuery} from "@tanstack/react-query";
import
{
	createContext,
	type Dispatch,
	type SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

import {projectsQueryOptions} from "../../lib/api/projects";
import {recentSessionsQueryOptions} from "../../lib/api/sessions";
import {carryPickToFolder, folderModeKey} from "../../lib/folder-permission-mode";
import {readHomeWorktreePref, writeHomeWorktreePref} from "../../lib/home-worktree-pref";
import type {LaunchOptions, LaunchPermissionMode} from "../../lib/launch-options";
import {startSessionProjects, type StartProject} from "../../lib/palette-start-session";

/** Same recents page the ⌘K palette reads, so both share one cached query. */
export const HOME_RECENT_LIMIT = 25;

type ChosenFolder = [string | null, Dispatch<SetStateAction<string | null>>];
type Launching = [boolean, Dispatch<SetStateAction<boolean>>];

export interface WorktreeState
{
	/** The persisted, browser-wide preference. */
	pref: boolean;
	/** This draft's override (upstream's per-opening `Jp` state); null follows the preference. */
	draft: boolean | null;
	/** Folders whose Next steps "Turn on Worktree" row was pressed in this draft. */
	taken: ReadonlySet<string>;
	/** Keys of the Next steps rows whose press prefilled this draft (upstream's per-opening `used`). */
	used: ReadonlySet<string>;
	/** Counts this provider's openings of the draft (upstream's composer `mountKey`); a launch starts the next. */
	opening: number;
	set: (enabled: boolean) => void;
	markUsed: (key: string) => void;
	setForDraft: (enabled: boolean | null) => void;
	takeFromRow: (folder: string) => void;
	endDraft: () => void;
}

/** The home draft's chin picks and the folder (`folderModeKey`) they were made in. */
interface HomeLaunchDraft
{
	folder: string | null;
	options: LaunchOptions;
}
type LaunchDraftState = [HomeLaunchDraft, Dispatch<SetStateAction<HomeLaunchDraft>>];

const EMPTY_LAUNCH_DRAFT: HomeLaunchDraft =
{
	folder: null,
	options: {},
};

export interface SharedLaunchFolder
{
	chosen: ChosenFolder;
	launching: Launching;
	worktree: WorktreeState;
	launchOptions: LaunchDraftState;
}

/** A fresh home draft's launch options state, held by `HomeLaunchFolderProvider`. */
export function useLaunchDraftState(): LaunchDraftState
{
	return useState(EMPTY_LAUNCH_DRAFT);
}

/** Upstream `n0`'s state: the preference starts off and loads after mount, so SSR and hydration agree. */
export function useWorktreeState(): WorktreeState
{
	const [pref, setPref] = useState(false);
	const [draft, setDraft] = useState<boolean | null>(null);
	const [taken, setTaken] = useState<ReadonlySet<string>>(() => new Set());
	const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
	const [opening, setOpening] = useState(0);
	useEffect(() =>
	{
		setPref(readHomeWorktreePref());
	}, []);
	return useMemo(() =>
	{
		// A hand toggle clears the draft override and writes the preference, as upstream's `set`.
		const set = (enabled: boolean) =>
		{
			setDraft(null);
			setPref(enabled);
			writeHomeWorktreePref(enabled);
			// Turning it off un-takes every row, so turning it back on by hand doesn't read as a press.
			if (!enabled) setTaken(new Set());
		};
		return {
			pref,
			draft,
			taken,
			used,
			opening,
			set,
			markUsed: (key: string) =>
			{
				setUsed((previous) => new Set(previous).add(key));
			},
			setForDraft: setDraft,
			// Upstream's worktree-apart press: `set(true)` (it writes the pref) and records the row taken.
			takeFromRow: (folder: string) =>
			{
				set(true);
				setTaken((previous) => new Set(previous).add(folder));
			},
			endDraft: () =>
			{
				setDraft(null);
				setTaken(new Set());
				setUsed(new Set());
				setOpening((previous) => previous + 1);
			},
		};
	}, [pref, draft, taken, used, opening]);
}

export const LaunchFolderContext = createContext<SharedLaunchFolder | null>(null);

export interface HomeLaunchFolder
{
	/** Launchable folders, most recently used first. */
	projects: StartProject[];
	selected: StartProject | undefined;
	select: (projectId: string) => void;
	/** True while the composer is starting a session (upstream's `starting`); folder rows drop out. */
	launching: boolean;
	setLaunching: (launching: boolean) => void;
}

/** The home launch folder (the chosen one, or the most recent) and its launching flag; local state outside a provider. */
export function useHomeLaunchFolder(): HomeLaunchFolder
{
	const shared = useContext(LaunchFolderContext);
	const localChosen = useState<string | null>(null);
	const localLaunching = useState(false);
	const [chosenId, setChosenId] = shared?.chosen ?? localChosen;
	const [launching, setLaunching] = shared?.launching ?? localLaunching;
	const {data: projects} = useQuery(projectsQueryOptions());
	const {data: recents} = useQuery(recentSessionsQueryOptions(HOME_RECENT_LIMIT));

	const startProjects = useMemo(
		() =>
			startSessionProjects(
				projects ?? [],
				(recents?.sessions ?? []).map((session) => session.project),
				undefined,
			),
		[projects, recents],
	);
	return {
		projects: startProjects,
		selected: startProjects.find((p) => p.id === chosenId) ?? startProjects[0],
		select: setChosenId,
		launching,
		setLaunching,
	};
}

export interface HomeWorktree
{
	/** The draft override, else the preference (upstream `draft ?? pref`). */
	enabled: boolean;
	/** False only for a folder known not to be a git repo; assumed true while its status is unknown. */
	supported: boolean;
	/** What the launch uses: `supported && enabled`. */
	useWorktree: boolean;
	/** Hand toggle: clears this draft's override and persists the preference. */
	set: (enabled: boolean) => void;
	/** Overrides only this draft; null goes back to the preference. */
	setForDraft: (enabled: boolean | null) => void;
	/** The selected folder's git status, undefined while unknown. */
	isGitRepo: boolean | undefined;
	/** A Next steps "Turn on Worktree" press: turns Worktree on and marks the folder's row taken. */
	takeFromRow: (folder: string) => void;
	/** The folder's row was pressed in this draft and Worktree is still on, so it reads "Worktree is on". */
	isTaken: (folder: string) => boolean;
	/** The launch ends the draft: its override and taken rows go back to the preference, and used rows return. */
	endDraft: () => void;
}

/**
 * The home draft's Worktree switch state, shared under `HomeLaunchFolderProvider` (local outside one).
 * `isGitRepo` is the selected folder's git status, undefined while unknown.
 */
export function useHomeWorktree(isGitRepo?: boolean): HomeWorktree
{
	const shared = useContext(LaunchFolderContext);
	const local = useWorktreeState();
	const {pref, draft, taken, set, setForDraft, takeFromRow, endDraft} = shared?.worktree ?? local;
	const enabled = draft ?? pref;
	const supported = isGitRepo ?? true;
	return {
		enabled,
		supported,
		useWorktree: supported && enabled,
		set,
		setForDraft,
		isGitRepo,
		takeFromRow,
		isTaken: (folder) => enabled && taken.has(folder),
		endDraft,
	};
}

export interface HomeDraftUsed
{
	/** Keys of the Next steps rows whose press prefilled this draft; they stay hidden until it ends. */
	used: ReadonlySet<string>;
	markUsed: (key: string) => void;
	/** The draft's opening, which a launch moves on; Next steps latches its slot order per opening. */
	opening: number;
}

/** The home draft's used Next steps rows, shared under `HomeLaunchFolderProvider` (local outside one). */
export function useHomeDraftUsed(): HomeDraftUsed
{
	const shared = useContext(LaunchFolderContext);
	const local = useWorktreeState();
	const {used, markUsed, opening} = shared?.worktree ?? local;
	return {
		used,
		markUsed,
		opening,
	};
}

/**
 * Upstream's folder-transfer effect (cf6ae6197 `Jt`) for `folder`: a Manual, Accept edits or Plan pick stays with the
 * draft, while an Auto or Bypass pick is dropped so the new folder's own memory or default takes over.
 */
function optionsInFolder(draft: HomeLaunchDraft, folder: string | null): LaunchOptions
{
	const pick = draft.options.permissionMode;
	if (
		draft.folder === folder ||
		pick === undefined ||
		carryPickToFolder(
			{
				pick,
			},
		)
	)
		return draft.options;
	const {permissionMode: _dropped, ...kept} = draft.options;
	return kept;
}

export interface HomeLaunchOptions
{
	/** The draft's chin picks (mode, model, effort, fast) as they apply in `cwd`. */
	options: LaunchOptions;
	set: (options: LaunchOptions) => void;
	/** Upstream's `permission.select(mode)` without the consent guard; callers offer only modes that owe none. */
	setPermissionMode: (mode: LaunchPermissionMode) => void;
}

/**
 * The home draft's launch options, shared between the docked composer's chin and the start card under
 * `HomeLaunchFolderProvider` (local state outside one). Switching `cwd` drops a pick that doesn't carry to a new
 * folder, at once and for good.
 */
export function useHomeLaunchOptions(cwd: string | undefined): HomeLaunchOptions
{
	const shared = useContext(LaunchFolderContext);
	const local = useLaunchDraftState();
	const [draft, setDraft] = shared?.launchOptions ?? local;
	const folder = folderModeKey(cwd);
	const options = optionsInFolder(draft, folder);
	// The read above already applies the drop; this commits it, so switching back doesn't restore the pick.
	useEffect(() =>
	{
		setDraft((previous) =>
			previous.folder === folder
				? previous
				:
					{
						folder,
						options: optionsInFolder(previous, folder),
					},
		);
	}, [folder, setDraft]);
	const set = useCallback(
		(next: LaunchOptions) =>
		{
			setDraft(
				{
					folder,
					options: next,
				},
			);
		},
		[folder, setDraft],
	);
	const setPermissionMode = useCallback(
		(mode: LaunchPermissionMode) =>
		{
			setDraft((previous) => (
			{
				folder,
				options:
				{
					...optionsInFolder(previous, folder),
					permissionMode: mode,
				},
			}));
		},
		[folder, setDraft],
	);
	return {
		options,
		set,
		setPermissionMode,
	};
}
