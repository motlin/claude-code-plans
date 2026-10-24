import {createContext, useContext} from "react";

/**
 * What to show when opening, like the argument to claude.ai/code's `openTask`:
 * a task to focus, an agent task to open in the Subagent pane, and whether to
 * expand the Finished section.
 */
export interface BackgroundTasksFocus {
	readonly taskId?: string;
	readonly finished?: boolean;
	readonly agentId?: string;
}

export interface BackgroundTasksOpener {
	/** Opens the Background tasks pane, which shows each task's output, optionally focused on a task. */
	open: (focus?: BackgroundTasksFocus) => void;
	/** The launching tool_use ids of background tasks still running. */
	running: ReadonlySet<string>;
}

const BackgroundTasksOpenerContext = createContext<BackgroundTasksOpener | null>(null);

export const BackgroundTasksOpenerProvider = BackgroundTasksOpenerContext.Provider;

/** The Background tasks pane opener, or null where no pane can host it. */
export function useBackgroundTasksOpener(): BackgroundTasksOpener | null {
	return useContext(BackgroundTasksOpenerContext);
}
