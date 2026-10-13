import {useEffect, useState} from "react";

import {registerPane} from "./pane-registry";
import {TerminalPane, type TerminalPaneAvailability} from "./terminal-pane";

/**
 * Registers the `terminal` pane kind while it has something to show: a live
 * herdr pane for this session (the Claude tab), Shell tabs, or a Claude tab
 * whose herdr pane has since closed, mirroring upstream showing the toggle
 * only when a transport exists. `interactive` follows the herdr writes
 * setting; without it the Claude tab stays a read-only observer.
 */
export function useRegisterTerminalPane(
	sessionId: string,
	{livePane, interactive, shells}: TerminalPaneAvailability,
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
			header: "custom",
			render: (chrome) => (
				<TerminalPane
					sessionId={sessionId}
					availability={{livePane, interactive, shells}}
					claudeEnded={claudeEnded}
					chrome={chrome}
				/>
			),
		});
	}, [sessionId, livePane, interactive, shells, claudeEnded]);
}
