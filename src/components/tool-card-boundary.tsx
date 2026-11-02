import type {ReactNode} from "react";

import type {ToolCardStage} from "../lib/tool-card-stage";
import {RenderErrorBoundary} from "./render-error-boundary";

/** Upstream `f7.part`, shared with the row banner's "row" copy. */
export const PART_CRASHED_COPY = "Couldn’t load this.";

/** Upstream `aW`: a crashed tool card's whole box, header included, becomes this one line. */
export function ToolCardCrashed()
{
	return (
		<div className="px-md py-xs text-center" data-testid="tool-card-crashed">
			<span className="text-body text-secondary">{PART_CRASHED_COPY}</span>
		</div>
	);
}

function reportToolCard(error: unknown)
{
	console.error("[tool-card]", error);
}

/**
 * Upstream's ChatToolCard boundary (`Vh`): the card retries only when its tool stage moves on, logs
 * once per stage, and keeps a chunk-load error in the card rather than escalating it.
 */
export function ToolCardBoundary({
	resetOn,
	fallback,
	children,
}: {
	resetOn: ToolCardStage;
	fallback?: ReactNode;
	children: ReactNode;
})
{
	return (
		<RenderErrorBoundary resetOn={resetOn} fallback={fallback ?? <ToolCardCrashed />} report={reportToolCard}>
			{children}
		</RenderErrorBoundary>
	);
}
