import {CatchBoundary} from "@tanstack/react-router";
import {lazy, Suspense, useState, type ComponentType, type ReactNode} from "react";
import type {PaneChrome} from "./pane-registry";

/**
 * Keep host controls available while an optional renderer loads or cannot be downloaded. Panes that draw their own
 * header pass `chrome`; the host draws the header of the rest.
 */
function DeferredPaneStatus({
	title,
	chrome,
	children,
}: {
	title: string;
	chrome: PaneChrome | undefined;
	children: ReactNode;
}) {
	return (
		<>
			{chrome !== undefined && (
				<div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
					<span data-pane-title className="truncate pl-1 text-pane text-secondary select-none">
						{title}
					</span>
					{chrome.moveHandle}
					<div className="relative flex shrink-0 items-center gap-0.5">{chrome.controls}</div>
				</div>
			)}
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-body text-ink-muted">
				{children}
			</div>
		</>
	);
}

interface DeferredPaneProps<P> {
	/** Clears a load failure when it changes, like the session the pane belongs to. */
	resetKey: string;
	chrome?: PaneChrome | undefined;
	props: P;
}

/** A deferred pane, plus the module download it shares with idle and intent warm-ups. */
export type DeferredPaneComponent<P> = ComponentType<DeferredPaneProps<P>> & {preload: () => Promise<ComponentType<P>>};

/**
 * A pane renderer kept off the cold load until the pane first shows. Its fallback and its Retry keep the header
 * controls in place, and a pane whose module already settled, from an earlier show or a `preload`, renders in the
 * first pass without flashing the fallback.
 */
export function deferredPane<P extends object>(
	title: string,
	load: () => Promise<ComponentType<P>>,
): DeferredPaneComponent<P> {
	let pending: Promise<ComponentType<P>> | undefined;
	let Loaded: ComponentType<P> | undefined;
	const preload = () => {
		pending ??= load().then(
			(component) => {
				Loaded = component;
				return component;
			},
			(error: unknown) => {
				// A failed download is retried on the next show or Retry.
				pending = undefined;
				throw error;
			},
		);
		return pending;
	};
	const loadDefault = () => preload().then((component) => ({default: component}));
	let Renderer = lazy(loadDefault);
	function DeferredPane({resetKey, chrome, props}: DeferredPaneProps<P>) {
		const [Pane, setPane] = useState(() => Loaded ?? Renderer);
		return (
			<CatchBoundary
				getResetKey={() => resetKey}
				errorComponent={({reset}) => (
					<DeferredPaneStatus title={title} chrome={chrome}>
						<p role="alert">Couldn't load {title}.</p>
						<button
							type="button"
							className="rounded-r5 border border-border px-3 py-1 text-primary hover:bg-fill-ghost-hover"
							onClick={() => {
								Renderer = lazy(loadDefault);
								setPane(() => Renderer);
								reset();
							}}
						>
							Retry
						</button>
					</DeferredPaneStatus>
				)}
			>
				<Suspense
					fallback={
						<DeferredPaneStatus title={title} chrome={chrome}>
							<p role="status">Loading {title.toLowerCase()}…</p>
						</DeferredPaneStatus>
					}
				>
					<Pane {...props} />
				</Suspense>
			</CatchBoundary>
		);
	}
	return Object.assign(DeferredPane, {preload});
}
