import {useOptionalPaneHost} from "./panes/pane-host-context";

/**
 * Upstream's "N running tasks" ghost button in muted 14/20 ink, drawn inside
 * the working line while a turn runs; it opens the Background tasks pane.
 */
export function RunningTasksControl({count}: {count: number}) {
	const host = useOptionalPaneHost();
	if (count === 0) return null;
	return (
		<span className="epitaxy-status-control inline-flex items-center">
			<button
				type="button"
				onClick={() => host?.openPane("background-tasks")}
				className="inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-body text-ink-muted"
			>
				{count === 1 ? "1 running task" : `${count} running tasks`}
			</button>
		</span>
	);
}
