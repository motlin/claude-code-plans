import {CatchBoundary} from "@tanstack/react-router";
import {lazy, Suspense, useEffect, useState, type ReactNode} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {registerPane, type PaneChrome} from "../panes/pane-registry";
import {usePaneHost} from "../panes/tile-host";

function loadChangesPane() {
	return import("./changes-pane").then((module) => ({default: module.ChangesPane}));
}

// Reopening a loaded pane reuses its fulfilled lazy component without flashing the fallback.
let ChangesPaneRenderer = lazy(loadChangesPane);

/** Keep host controls available while the optional renderer loads or cannot be downloaded. */
function ChangesPaneStatus({chrome, children}: {chrome: PaneChrome; children: ReactNode}) {
	return (
		<>
			<div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-1">
				<span data-pane-title className="truncate pl-1 text-pane text-secondary select-none">
					Changes
				</span>
				{chrome.moveHandle}
				<div className="relative flex shrink-0 items-center gap-0.5">{chrome.controls}</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-body text-ink-muted">
				{children}
			</div>
		</>
	);
}

function DeferredChangesPane({sessionId, chrome}: {sessionId: string; chrome: PaneChrome}) {
	const [Pane, setPane] = useState(() => ChangesPaneRenderer);
	return (
		<CatchBoundary
			getResetKey={() => sessionId}
			errorComponent={({reset}) => (
				<ChangesPaneStatus chrome={chrome}>
					<p role="alert">Couldn't load Changes.</p>
					<button
						type="button"
						className="rounded-r5 border border-border px-3 py-1 text-primary hover:bg-fill-ghost-hover"
						onClick={() => {
							ChangesPaneRenderer = lazy(loadChangesPane);
							setPane(() => ChangesPaneRenderer);
							reset();
						}}
					>
						Retry
					</button>
				</ChangesPaneStatus>
			)}
		>
			<Suspense
				fallback={
					<ChangesPaneStatus chrome={chrome}>
						<p role="status">Loading changes…</p>
					</ChangesPaneStatus>
				}
			>
				<Pane sessionId={sessionId} chrome={chrome} />
			</Suspense>
		</CatchBoundary>
	);
}

/** Register metadata immediately so saved layouts and deep links retain the pane while its renderer loads. */
export function useRegisterChangesPane(sessionId: string): void {
	useEffect(
		() =>
			registerPane("changes", {
				title: "Changes",
				header: "custom",
				render: (chrome) => <DeferredChangesPane sessionId={sessionId} chrome={chrome} />,
			}),
		[sessionId],
	);
}

/** Binds ⌃⇧D whether the titlebar toggle is shown or folded. */
export function ChangesPaneShortcut() {
	const host = usePaneHost();
	useShortcut("toggle_changes", () => host.togglePane("changes"));
	return null;
}
