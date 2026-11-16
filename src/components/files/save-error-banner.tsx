import type {MouseEvent} from "react";

import {bannerCopy, retryLabel, type SaveError} from "../../lib/source-save";
import {cdsButtonClass} from "../ui/cds-button";

/** Upstream's shared-viewer save band (`GS`); in a pane header line the start pad matches the header text. */
const BAND = "shrink-0 pe-sm py-sm bg-alpha-2 flex flex-wrap items-center gap-1";

function keepEditorFocus(event: MouseEvent): void
{
	event.preventDefault();
}

/**
 * Upstream's save-error alert (`iC`): the failure copy, Discard, and a kind-specific retry
 * (Try again / Override / Save anyway; none when denied). Buttons never take the editor's
 * focus and stay disabled while a save is in flight.
 */
export function SaveErrorBanner({
	error,
	busy,
	inPaneHeaderLine,
	onDiscard,
	onRetry,
}: {
	error: SaveError;
	busy: boolean;
	inPaneHeaderLine: boolean;
	onDiscard: () => void;
	onRetry: () => void;
})
{
	const retry = retryLabel(error);
	return (
		<div
			role="alert"
			data-save-error={error.kind}
			className={
				inPaneHeaderLine
					? `${BAND} ps-[calc(1.25rem*var(--cds-rem-scale,1))]`
					: BAND.replace("shrink-0 ", "shrink-0 ps-md ")
			}
		>
			<span className="grow basis-40 text-body text-primary">{bannerCopy(error)}</span>
			<div className="ms-auto flex flex-wrap justify-end gap-1">
				<button
					type="button"
					className={cdsButtonClass("ghost")}
					onMouseDown={keepEditorFocus}
					onClick={onDiscard}
					disabled={busy}
				>
					Discard
				</button>
				{retry !== null && (
					<button
						type="button"
						className={cdsButtonClass("secondary")}
						onMouseDown={keepEditorFocus}
						onClick={onRetry}
						disabled={busy}
					>
						{retry}
					</button>
				)}
			</div>
		</div>
	);
}
