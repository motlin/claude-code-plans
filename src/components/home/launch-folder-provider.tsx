import {type ReactNode, useEffect, useMemo, useState} from "react";

import {onHomeLaunchFolderRequest, takePendingHomeLaunchFolder} from "../../lib/home-composer-focus";
import {LaunchFolderContext, useWorktreeState} from "./launch-folder";

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
