/** A terminal multiplexer a pane can come from. */
export type TerminalPaneHost = "herdr" | "tmux";

export interface TerminalHostCapabilities {
	/** Can type into panes at all; Live terminal input still gates it. */
	canWrite: boolean;
	/** Can stream a pane into the live terminal tab. */
	canStream: boolean;
}

/**
 * What each host supports, shared by the server's hosts and the browser, which
 * reads it per pane (`pane.host`).
 */
export const TERMINAL_HOST_CAPABILITIES = {
	herdr: {canWrite: true, canStream: true},
	tmux: {canWrite: true, canStream: true},
} as const satisfies Record<TerminalPaneHost, TerminalHostCapabilities>;

/** Whether the session has a pane the live terminal tab can stream. */
export function sessionHasLiveTerminal(
	panes: ReadonlyArray<{sessionId: string; host: TerminalPaneHost}> | undefined,
	sessionId: string,
): boolean {
	return (
		panes?.some((pane) => pane.sessionId === sessionId && TERMINAL_HOST_CAPABILITIES[pane.host].canStream) ?? false
	);
}
