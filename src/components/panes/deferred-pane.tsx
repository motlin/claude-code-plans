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

/**
 * A pane renderer kept off the cold load until the pane first shows. Its fallback and its Retry keep the header
 * controls in place, and reopening a loaded pane reuses the fulfilled lazy component without flashing the fallback.
 */
export function deferredPane<P extends object>(
	title: string,
	load: () => Promise<ComponentType<P>>,
): ComponentType<DeferredPaneProps<P>> {
	const loadDefault = () => load().then((component) => ({default: component}));
	let Renderer = lazy(loadDefault);
	return function DeferredPane({resetKey, chrome, props}: DeferredPaneProps<P>) {
		const [Pane, setPane] = useState(() => Renderer);
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
	};
}
