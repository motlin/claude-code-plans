import {useQuery} from "@tanstack/react-query";
import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

import {projectsQueryOptions} from "../../lib/api/projects";
import {recentSessionsQueryOptions} from "../../lib/api/sessions";
import {onHomeLaunchFolderRequest, takePendingHomeLaunchFolder} from "../../lib/home-composer-focus";
import {readHomeWorktreePref, writeHomeWorktreePref} from "../../lib/home-worktree-pref";
import {startSessionProjects, type StartProject} from "../../lib/palette-start-session";

/** Same recents page the ⌘K palette reads, so both share one cached query. */
export const HOME_RECENT_LIMIT = 25;

type ChosenFolder = [string | null, Dispatch<SetStateAction<string | null>>];
type Launching = [boolean, Dispatch<SetStateAction<boolean>>];

interface WorktreeState {
	/** The persisted, browser-wide preference. */
	pref: boolean;
	/** This draft's override (upstream's per-opening `Jp` state); null follows the preference. */
	draft: boolean | null;
	/** Folders whose Next steps "Turn on Worktree" row was pressed in this draft. */
	taken: ReadonlySet<string>;
	/** Keys of the Next steps rows whose press prefilled this draft (upstream's per-opening `used`). */
	used: ReadonlySet<string>;
	set: (enabled: boolean) => void;
	markUsed: (key: string) => void;
	setForDraft: (enabled: boolean | null) => void;
	takeFromRow: (folder: string) => void;
	endDraft: () => void;
}

interface SharedLaunchFolder {
	chosen: ChosenFolder;
	launching: Launching;
	worktree: WorktreeState;
}

/** Upstream `n0`'s state: the preference starts off and loads after mount, so SSR and hydration agree. */
function useWorktreeState(): WorktreeState {
	const [pref, setPref] = useState(false);
	const [draft, setDraft] = useState<boolean | null>(null);
	const [taken, setTaken] = useState<ReadonlySet<string>>(() => new Set());
	const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
	useEffect(() => {
		setPref(readHomeWorktreePref());
	}, []);
	return useMemo(() => {
		// A hand toggle clears the draft override and writes the preference, as upstream's `set`.
		const set = (enabled: boolean) => {
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
			set,
			markUsed: (key: string) => {
				setUsed((previous) => new Set(previous).add(key));
			},
			setForDraft: setDraft,
			// Upstream's worktree-apart press: `set(true)` (it writes the pref) and records the row taken.
			takeFromRow: (folder: string) => {
				set(true);
				setTaken((previous) => new Set(previous).add(folder));
			},
			endDraft: () => {
				setDraft(null);
				setTaken(new Set());
				setUsed(new Set());
			},
		};
	}, [pref, draft, taken, used]);
}

const LaunchFolderContext = createContext<SharedLaunchFolder | null>(null);

/**
 * Shares the home launch folder, and whether the composer is launching a session in it, between the
 * start card and the docked composer. The folder starts from one requested before home mounted and
 * follows later requests.
 */
export function HomeLaunchFolderProvider({children}: Readonly<{children: ReactNode}>) {
	const chosen = useState<string | null>(null);
	const launching = useState(false);
	const worktree = useWorktreeState();
	const [, setChosenId] = chosen;
	useEffect(() => {
		const pending = takePendingHomeLaunchFolder();
		if (pending !== null) setChosenId(pending);
		return onHomeLaunchFolderRequest(setChosenId);
	}, [setChosenId]);
	const shared = useMemo(() => ({chosen, launching, worktree}), [chosen, launching, worktree]);
	return <LaunchFolderContext.Provider value={shared}>{children}</LaunchFolderContext.Provider>;
}

export interface HomeLaunchFolder {
	/** Launchable folders, most recently used first. */
	projects: StartProject[];
	selected: StartProject | undefined;
	select: (projectId: string) => void;
	/** True while the composer is starting a session (upstream's `starting`); folder rows drop out. */
	launching: boolean;
	setLaunching: (launching: boolean) => void;
}

/** The home launch folder (the chosen one, or the most recent) and its launching flag; local state outside a provider. */
export function useHomeLaunchFolder(): HomeLaunchFolder {
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

export interface HomeWorktree {
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
	/** The selected folder's git status, undefined while unknown (the folder picker hides its footer on false). */
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
export function useHomeWorktree(isGitRepo?: boolean): HomeWorktree {
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

export interface HomeDraftUsed {
	/** Keys of the Next steps rows whose press prefilled this draft; they stay hidden until it ends. */
	used: ReadonlySet<string>;
	markUsed: (key: string) => void;
}

/** The home draft's used Next steps rows, shared under `HomeLaunchFolderProvider` (local outside one). */
export function useHomeDraftUsed(): HomeDraftUsed {
	const shared = useContext(LaunchFolderContext);
	const local = useWorktreeState();
	const {used, markUsed} = shared?.worktree ?? local;
	return {used, markUsed};
}
