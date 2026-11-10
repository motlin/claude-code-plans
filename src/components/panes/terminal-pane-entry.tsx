import {useEffect, useState} from "react";

import {ApprovalActionButton} from "../approval-card";
import {deferredPane} from "./deferred-pane";
import {PanePlaceholder} from "./pane-placeholder";
import {registerPane} from "./pane-registry";
import type {TerminalPaneAvailability} from "./terminal-pane";

const DeferredTerminalPane = deferredPane(
	"Terminal",
	async () => import("./terminal-pane").then((module) => module.TerminalPane),
	{
		// Upstream's ShellTerminalChunk fallback (`sw`).
		unrecoverable: (reload) => (
			<div className="absolute inset-0">
				<PanePlaceholder
					role="alert"
					icon="Warning"
					title="Couldn’t load the terminal"
					body="Reload the page to try again."
					actions={
						<ApprovalActionButton variant="secondary" size="sm" onClick={reload}>
							Reload
						</ApprovalActionButton>
					}
				/>
			</div>
		),
	},
);

/** Downloads the Terminal pane renderer ahead of its first show. */
export const preloadTerminalPane = DeferredTerminalPane.preload;

/**
 * Registers the `terminal` pane kind while it has something to show: a live
 * herdr pane for this session (the Claude tab), Shell tabs, or a Claude tab
 * whose herdr pane has since closed, mirroring upstream showing the toggle
 * only when a transport exists. `interactive` follows the herdr writes
 * setting; without it the Claude tab stays a read-only observer.
 *
 * `openTerminalHere` (stable) adds the header menu's "Open terminal here".
 */
export function useRegisterTerminalPane(
	sessionId: string,
	{livePane, interactive, shells}: TerminalPaneAvailability,
	openTerminalHere?: () => Promise<void>,
): void {
	const [livePaneSeenFor, setLivePaneSeenFor] = useState<string | null>(null);
	useEffect(() => {
		if (livePane) setLivePaneSeenFor(sessionId);
	}, [livePane, sessionId]);
	const claudeEnded = !livePane && livePaneSeenFor === sessionId;

	useEffect(() => {
		if (!livePane && !shells && !claudeEnded) return undefined;
		return registerPane("terminal", {
			title: "Terminal",
			resetKey: sessionId,
			header: "custom",
			render: (chrome) => (
				<DeferredTerminalPane
					resetKey={sessionId}
					chrome={chrome}
					props={{
						sessionId,
						availability: {livePane, interactive, shells},
						claudeEnded,
						chrome,
						onOpenTerminalHere: openTerminalHere,
					}}
				/>
			),
		});
	}, [sessionId, livePane, interactive, shells, claudeEnded, openTerminalHere]);
}
