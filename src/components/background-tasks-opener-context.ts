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
	/** Each running background task's launching tool_use id, mapped to its task id. */
	running: ReadonlyMap<string, string>;
}

const BackgroundTasksOpenerContext = createContext<BackgroundTasksOpener | null>(null);

export const BackgroundTasksOpenerProvider = BackgroundTasksOpenerContext.Provider;

/** The Background tasks pane opener, or null where no pane can host it. */
export function useBackgroundTasksOpener(): BackgroundTasksOpener | null {
	return useContext(BackgroundTasksOpenerContext);
}
