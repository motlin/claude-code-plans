import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";

/**
 * Upstream's transcript-tail status control, "N running tasks" in muted 14/20
 * ink at the transcript's text inset, shown while background tasks run.
 */
export function RunningTasksControl({count}: {count: number}) {
	if (count === 0) return null;
	return (
		// Clears the dock's 32px fade, which would otherwise wash out the transcript's last line.
		<div className={`${CHAT_COLUMN_CLASS} pb-8`}>
			<span className="epitaxy-status-control inline-flex items-center">
				<button
					type="button"
					className="inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-body text-ink-muted"
				>
					{count === 1 ? "1 running task" : `${count} running tasks`}
				</button>
			</span>
		</div>
	);
}
