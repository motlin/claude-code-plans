import type {MouseEvent} from "react";

import {cdsButtonClass} from "./ui/cds-button";
import {CDS_ICON_ONLY_DISABLED} from "./ui/cds-button-disabled";
import {Icon} from "./ui/icon";
import {Spinner} from "./ui/spinner";
import {Tooltip} from "./ui/tooltip";

/** Upstream's `+ZLTl3`. */
const STOP_TASK_LABEL = "Stop this task";
/** Upstream's busy label and the status text a stopping row shows in place of its elapsed time. */
export const STOPPING_LABEL = "Stopping…";

/**
 * Upstream's per-task Stop: a cds Button, size xs, iconOnly with the StopFilled glyph at sm (16px), `shrink-0`, busy while
 * the stop is in flight. The pane draws it secondary, the rail ghost and flush to the row's end (cds `flush: "end"`, a
 * -4px end margin); both open its tooltip on the left.
 * A double-click stops once (`detail <= 1`), and the press never reaches the row around it.
 */
export function BackgroundTaskStopButton({
	variant,
	flushEnd = false,
	busy,
	describedBy,
	onStop,
}: {
	variant: "secondary" | "ghost";
	/** Pull the button 4px past the row's end padding, as cds `flush: "end"` does for an xs control. */
	flushEnd?: boolean;
	busy: boolean;
	/** The row title's id, which upstream's button points `aria-describedby` at. */
	describedBy?: string;
	onStop: () => void;
})
{
	return (
		<Tooltip content={busy ? STOPPING_LABEL : STOP_TASK_LABEL} side="left">
			<button
				type="button"
				data-size="xs"
				aria-label={STOP_TASK_LABEL}
				aria-describedby={describedBy}
				{...(busy
					?
						{
							"aria-busy": "true",
							"aria-disabled": "true",
						}
					: {})}
				onClick={(event: MouseEvent<HTMLButtonElement>) =>
				{
					event.stopPropagation();
					if (busy || event.detail > 1) return;
					onStop();
				}}
				className={`${cdsButtonClass(variant, "xs")} aspect-square shrink-0 !px-0${flushEnd ? " -me-1" : ""} ${CDS_ICON_ONLY_DISABLED}`}
			>
				<span className={busy ? "opacity-0" : undefined}>
					<Icon name="StopFilled" size="sm" />
				</span>
				{busy && (
					<span aria-hidden="true" className="absolute inset-0 grid place-items-center">
						<Spinner size="sm" tone="current" />
					</span>
				)}
			</button>
		</Tooltip>
	);
}
