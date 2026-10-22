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
import {startSessionProjects, type StartProject} from "../../lib/palette-start-session";

/** Same recents page the ⌘K palette reads, so both share one cached query. */
export const HOME_RECENT_LIMIT = 25;

type ChosenFolder = [string | null, Dispatch<SetStateAction<string | null>>];
type Launching = [boolean, Dispatch<SetStateAction<boolean>>];

interface SharedLaunchFolder {
	chosen: ChosenFolder;
	launching: Launching;
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
	const [, setChosenId] = chosen;
	useEffect(() => {
		const pending = takePendingHomeLaunchFolder();
		if (pending !== null) setChosenId(pending);
		return onHomeLaunchFolderRequest(setChosenId);
	}, [setChosenId]);
	const shared = useMemo(() => ({chosen, launching}), [chosen, launching]);
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
