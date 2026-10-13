import {createContext, useContext} from "react";

export interface BackgroundTasksOpener {
	/** Opens the Background tasks pane, which shows each task's output. */
	open: () => void;
	/** The launching tool_use ids of background tasks still running. */
	running: ReadonlySet<string>;
}

const BackgroundTasksOpenerContext = createContext<BackgroundTasksOpener | null>(null);

export const BackgroundTasksOpenerProvider = BackgroundTasksOpenerContext.Provider;

/** The Background tasks pane opener, or null where no pane can host it. */
export function useBackgroundTasksOpener(): BackgroundTasksOpener | null {
	return useContext(BackgroundTasksOpenerContext);
}
