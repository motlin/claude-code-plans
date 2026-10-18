import {useQuery} from "@tanstack/react-query";
import {createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useMemo, useState} from "react";

import {projectsQueryOptions} from "../../lib/api/projects";
import {recentSessionsQueryOptions} from "../../lib/api/sessions";
import {startSessionProjects, type StartProject} from "../../lib/palette-start-session";

/** Same recents page the ⌘K palette reads, so both share one cached query. */
export const HOME_RECENT_LIMIT = 25;

type ChosenFolder = [string | null, Dispatch<SetStateAction<string | null>>];

const LaunchFolderContext = createContext<ChosenFolder | null>(null);

/** Shares the home launch folder between the start card and the docked composer. */
export function HomeLaunchFolderProvider({children}: Readonly<{children: ReactNode}>) {
	const chosen = useState<string | null>(null);
	return <LaunchFolderContext.Provider value={chosen}>{children}</LaunchFolderContext.Provider>;
}

export interface HomeLaunchFolder {
	/** Launchable folders, most recently used first. */
	projects: StartProject[];
	selected: StartProject | undefined;
	select: (projectId: string) => void;
}

/** The home launch folder: the chosen one, or the most recent; local state outside a provider. */
export function useHomeLaunchFolder(): HomeLaunchFolder {
	const shared = useContext(LaunchFolderContext);
	const local = useState<string | null>(null);
	const [chosenId, setChosenId] = shared ?? local;
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
	};
}
