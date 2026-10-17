import {splitHerdrId} from "./herdr/herdr-id";
import type {TerminalPaneHost} from "./terminal-host-capabilities";

/** The fields of a terminal-host pane link that say where a session runs. */
export interface EnvironmentPane {
	host: TerminalPaneHost;
	paneId: string;
	/** For tmux, the tmux session name. */
	workspaceId: string;
}

export interface SessionEnvironment {
	/** Where the session runs: `herdr`, `herdr · <named session>`, `tmux · <session>`, or `Local`. */
	label: string;
	/** `Remote Control · Connected` (or `· Offline`) when bridged to claude.ai; null otherwise. */
	remoteControl: string | null;
}

/**
 * A local session's Environment, shared by the rail's Environment card and the
 * sidebar row's sr-only text so they can't disagree. Upstream labels a bridged
 * session "Remote Control"; here the session is a local process, so the
 * primary label is its terminal host (from `terminalHostLabel`, null for
 * Local) and Remote Control is a secondary detail.
 */
export function sessionEnvironment({
	terminalHost,
	bridged,
	live,
}: {
	terminalHost: string | null;
	bridged: boolean;
	live: boolean;
}): SessionEnvironment {
	return {
		label: terminalHost ?? "Local",
		remoteControl: bridged ? `Remote Control · ${live ? "Connected" : "Offline"}` : null,
	};
}

/** Where a pane runs: `herdr`, `herdr · <named session>`, or `tmux · <session>`. */
export function terminalHostLabel(pane: EnvironmentPane): string {
	if (pane.host === "tmux") return `tmux · ${pane.workspaceId}`;
	const {session} = splitHerdrId(pane.paneId);
	return session === null ? "herdr" : `herdr · ${session}`;
}

export function sessionEnvironmentText({label, remoteControl}: SessionEnvironment): string {
	return remoteControl === null ? label : `${label} · ${remoteControl}`;
}
