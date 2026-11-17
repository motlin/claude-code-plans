import type {BackgroundTaskGroups} from "../../lib/background-tasks";
import {dismissTasks} from "../../lib/dismissed-tasks";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";
import {PANE_HEADER_ICON_BUTTON_CLASS} from "./pane-classes";

/**
 * Upstream's `YL`: the Background tasks pane header's ghost Trash button, which dismisses every finished task for this
 * session in this browser. With nothing finished it stays focusable with its tooltip but turns `aria-disabled` (never
 * `disabled`), and a click does nothing.
 */
export function ClearFinishedTasksButton({sessionId, groups}: {sessionId: string; groups: BackgroundTaskGroups})
{
	return (
		<Tooltip content="Clear finished tasks">
			<button
				type="button"
				aria-label="Clear finished tasks"
				aria-disabled={groups.finished.length === 0 ? true : undefined}
				className={`${PANE_HEADER_ICON_BUTTON_CLASS} aria-disabled:cursor-default aria-disabled:opacity-disabled`}
				onClick={() =>
				{
					dismissTasks(
						sessionId,
						groups.finished.map((task) => task.id),
					);
				}}
			>
				<Icon name="Trash" size="sm" />
			</button>
		</Tooltip>
	);
}
