import {type ReactNode, useId, useState} from "react";

import {CHUNK_ERROR_COPY, type ChunkErrorState, reloadsPage} from "../lib/chunk-error-state";
import {browserStaleChunkDeps} from "../lib/stale-chunk-reload";
import {ApprovalActionButton} from "./approval-action-button";

/**
 * Upstream's recovery-kit ErrorView (`G5`): a status line plus a small secondary Retry or Reload.
 * With a `placeholder` (the surface's loading placeholder) it overlays an invisible copy of it so the box keeps
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

/** A failed lazy download drawn as upstream's ErrorView, busy once its Reload was pressed. */
export function InlineChunkError({
	state,
	placeholder,
	onRetry,
}: {
	state: ChunkErrorState;
	placeholder: ReactNode;
	onRetry: () => void;
})
{
	const [busy, setBusy] = useState(false);
	return (
		<ChunkErrorView
			state={state}
			busy={busy}
			placeholder={placeholder}
			onRetry={onRetry}
			onReload={() =>
			{
				setBusy(true);
				browserStaleChunkDeps.reload();
			}}
		/>
	);
}
