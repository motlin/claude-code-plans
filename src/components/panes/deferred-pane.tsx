import {lazy, Suspense, useState, type ComponentType, type ReactNode} from "react";

import {isStaleChunkError} from "../../lib/stale-chunk-reload";
import {RenderErrorBoundary} from "../render-error-boundary";
import {DeferredChunkFailure, DeferredPaneLoading} from "./chunk-error-view";
import {DeferredPaneStatus} from "./deferred-pane-status";
import type {PaneChrome} from "./pane-registry";

interface DeferredPaneProps<P> {
	/** Clears a load failure when it changes, like the session the pane belongs to. */
	resetKey: string;
	chrome?: PaneChrome | undefined;
	props: P;
}

export interface DeferredPaneOptions {
	/**
	 * Upstream's chunk-only boundary fallback (the terminal's `sw`): drawn instead of the inline ErrorView
	 * once a reload already failed to bring the chunk back. It fills a `relative` pane body.
	 */
	unrecoverable?: (reload: () => void) => ReactNode;
}

/** A deferred pane, plus the module download it shares with idle and intent warm-ups. */
export type DeferredPaneComponent<P> = ComponentType<DeferredPaneProps<P>> & {preload: () => Promise<ComponentType<P>>};

function reportChunkError(error: unknown) {
	console.error("[pane-chunk]", error);
}

/**
 * A pane renderer kept off the cold load until the pane first shows. A failed download shows upstream's inline
 * ErrorView with the header controls kept in place; render crashes pass through to the pane crash boundary. A pane
 * whose module already settled, from an earlier show or a `preload`, renders in the first pass without flashing
 * the fallback.
 */
export function deferredPane<P extends object>(
	title: string,
	load: () => Promise<ComponentType<P>>,
	{unrecoverable}: DeferredPaneOptions = {},
): DeferredPaneComponent<P> {
	let pending: Promise<ComponentType<P>> | undefined;
	let Loaded: ComponentType<P> | undefined;
	// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download shared by every warm-up
	const preload = (): Promise<ComponentType<P>> => {
		pending ??= load().then(
			(component) => {
				Loaded = component;
				return component;
			},
			(error: unknown) => {
				// A failed download is retried on the next show or Retry.
				pending = undefined;
				Renderer = lazy(loadDefault);
				throw error;
			},
		);
		return pending;
	};
	const loadDefault = async () => preload().then((component) => ({default: component}));
	let Renderer = lazy(loadDefault);
	function DeferredPane({resetKey, chrome, props}: DeferredPaneProps<P>) {
		const [Pane, setPane] = useState(() => Loaded ?? Renderer);
		const [retries, setRetries] = useState(0);
		return (
			<RenderErrorBoundary
				resetOn={resetKey}
				report={reportChunkError}
				fallback={(error, reset) => {
					// Upstream's chunk boundaries (`hv`, `aw`) catch only chunk-load errors.
					if (!isStaleChunkError(error)) throw error;
					return (
						<DeferredChunkFailure
							title={title}
							chrome={chrome}
							retried={retries > 0}
							unrecoverable={unrecoverable}
							onRetry={() => {
								Renderer = lazy(loadDefault);
								setPane(() => Renderer);
								setRetries((count) => count + 1);
								reset();
							}}
						/>
					);
				}}
			>
				<Suspense
					fallback={
						<DeferredPaneStatus title={title} chrome={chrome}>
							<DeferredPaneLoading title={title} />
						</DeferredPaneStatus>
					}
				>
					<Pane {...props} />
				</Suspense>
			</RenderErrorBoundary>
		);
	}
	return Object.assign(DeferredPane, {preload});
}
