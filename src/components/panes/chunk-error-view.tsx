import type {ReactNode} from "react";

import {currentChunkErrorState} from "../../lib/chunk-error-state";
import {browserStaleChunkDeps} from "../../lib/stale-chunk-reload";
import {InlineChunkError} from "../chunk-error-view";
import {DeferredPaneStatus, PaneChromeHeader} from "./deferred-pane-status";
import type {PaneChrome} from "./pane-registry";

function reloadPage()
{
	browserStaleChunkDeps.reload();
}

/** A failed pane download: upstream's inline ErrorView over the loading status, or the pane's unrecoverable fallback. */
export function DeferredChunkFailure({
	title,
	chrome,
	retried,
	unrecoverable,
	onRetry,
}: {
	title: string;
	chrome: PaneChrome | undefined;
	retried: boolean;
	unrecoverable: ((reload: () => void) => ReactNode) | undefined;
	onRetry: () => void;
})
{
	const state = currentChunkErrorState(retried);
	if (state === "reload" && unrecoverable !== undefined)
		return (
			<>
				{chrome !== undefined && <PaneChromeHeader title={title} chrome={chrome} />}
				<div className="relative min-h-0 flex-1">{unrecoverable(reloadPage)}</div>
			</>
		);
	return (
		<DeferredPaneStatus title={title} chrome={chrome}>
			<InlineChunkError state={state} placeholder={<DeferredPaneLoading title={title} />} onRetry={onRetry} />
		</DeferredPaneStatus>
	);
}

/** A deferred pane's loading line, also kept invisibly under its ErrorView so the box keeps its size. */
export function DeferredPaneLoading({title}: {title: string})
{
	return <p role="status">Loading {title.toLowerCase()}…</p>;
}
