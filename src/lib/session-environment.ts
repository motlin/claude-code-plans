import {splitHerdrId} from "./herdr/herdr-id";
import {remoteControlStateLabels} from "./schema-choices";
import {claudeAiSessionUrl} from "./session-open-in";
import type {RemoteControlState} from "./session-state";
import type {TerminalPaneHost} from "./terminal-host-capabilities";

/** What the rail's Remote Control row shows: the bridge state and, while on, its claude.ai session url. */
export interface RemoteControl {
	state: RemoteControlState;
	url: string | null;
}

/**
 * The Remote Control bridge of a session's live registry entry
 * (`~/.claude/sessions/<pid>.json`): on with its claude.ai url while
 * `bridgeSessionId` is set, off once it is `null`. Null without a live entry,
 * or from an older CLI that does not write the field, so the row stays hidden
 * where no toggle is possible.
 */
export function registryRemoteControl(entry: {bridgeSessionId?: string | null} | null): RemoteControl | null {
	if (entry?.bridgeSessionId === undefined) return null;
	return entry.bridgeSessionId === null
		? {state: "off", url: null}
		: {state: "on", url: claudeAiSessionUrl(entry.bridgeSessionId)};
}

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
	/** The live CLI's Remote Control bridge state; null when no live process reports one. */
	remoteControl: RemoteControlState | null;
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
	remoteControl,
}: {
	terminalHost: string | null;
	remoteControl: RemoteControlState | null;
}): SessionEnvironment {
	return {label: terminalHost ?? "Local", remoteControl};
}

/** Where a pane runs: `herdr`, `herdr · <named session>`, or `tmux · <session>`. */
export function terminalHostLabel(pane: EnvironmentPane): string {
	if (pane.host === "tmux") return `tmux · ${pane.workspaceId}`;
	const {session} = splitHerdrId(pane.paneId);
	return session === null ? "herdr" : `herdr · ${session}`;
}

export function sessionEnvironmentText({label, remoteControl}: SessionEnvironment): string {
	return remoteControl === null ? label : `${label} · ${remoteControlStateLabels[remoteControl]}`;
}
