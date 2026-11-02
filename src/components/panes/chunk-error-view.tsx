import {type ReactNode, useId, useState} from "react";

import {CHUNK_ERROR_COPY, type ChunkErrorState, chunkErrorState, reloadsPage} from "../../lib/chunk-error-state";
import {browserStaleChunkDeps, staleChunkReloadRecent} from "../../lib/stale-chunk-reload";
import {ApprovalActionButton} from "../approval-card";
import {DeferredPaneStatus, PaneChromeHeader} from "./deferred-pane-status";
import type {PaneChrome} from "./pane-registry";

/**
 * Upstream's recovery-kit ErrorView (`G5`): a status line plus a small secondary Retry or Reload.
 * With a `placeholder` (the pane's loading status) it overlays an invisible copy of it so the box keeps
 * the loading size.
 */
export function ChunkErrorView({
	state,
	busy = false,
	placeholder,
	onRetry,
	onReload,
}: {
	state: ChunkErrorState;
	busy?: boolean;
	placeholder?: ReactNode;
	onRetry: () => void;
	onReload: () => void;
})
{
	const id = useId();
	const reload = reloadsPage(state);
	const content = (
		<>
			<span id={id} className="min-w-0 text-body text-muted-as-secondary" role="status">
				{CHUNK_ERROR_COPY[state]}
			</span>
			<ApprovalActionButton variant="secondary" size="sm" disabled={busy} onClick={reload ? onReload : onRetry}>
				{reload ? "Reload" : "Retry"}
			</ApprovalActionButton>
		</>
	);
	if (placeholder === undefined)
		return (
			<div
				className="flex min-w-0 flex-wrap items-center justify-center gap-xs px-md py-xs text-center"
				data-chunk-error={state}
			>
				{content}
			</div>
		);
	return (
		<div className="grid min-w-0" data-chunk-error={state}>
			<div aria-hidden className="invisible col-start-1 row-start-1">
				{placeholder}
			</div>
			<div className="col-start-1 row-start-1 flex w-0 min-w-full flex-col items-center justify-center gap-xs px-md py-xs text-center">
				{content}
			</div>
		</div>
	);
}

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
	const [busy, setBusy] = useState(false);
	const state = chunkErrorState(
		{
			online: navigator.onLine,
			reloadUsed: staleChunkReloadRecent(),
			retried,
		},
	);
	if (state === "reload" && unrecoverable !== undefined)
		return (
			<>
				{chrome !== undefined && <PaneChromeHeader title={title} chrome={chrome} />}
				<div className="relative min-h-0 flex-1">{unrecoverable(reloadPage)}</div>
			</>
		);
	return (
		<DeferredPaneStatus title={title} chrome={chrome}>
			<ChunkErrorView
				state={state}
				busy={busy}
				placeholder={<DeferredPaneLoading title={title} />}
				onRetry={onRetry}
				onReload={() =>
				{
					setBusy(true);
					reloadPage();
				}}
			/>
		</DeferredPaneStatus>
	);
}

/** A deferred pane's loading line, also kept invisibly under its ErrorView so the box keeps its size. */
export function DeferredPaneLoading({title}: {title: string})
{
	return <p role="status">Loading {title.toLowerCase()}…</p>;
}
