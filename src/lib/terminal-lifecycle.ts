import {assertNever} from "./assert-never";

/**
 * One Shell tab's connection lifecycle, from socket events to what the pane
 * draws: the loading placeholder, dim in-band link lines while the socket
 * drops and returns, and the "Shell exited." / "Failed to start shell"
 * overlay with Restart shell and Reconnect.
 */
export type TerminalPhase = "loading" | "connecting" | "live" | "reconnecting" | "exited" | "failed" | "load-failed";

export interface TerminalLifecycle {
	phase: TerminalPhase;
	/** Overlay title for `failed`, plus an optional detail line. */
	title: string | null;
	detail: string | null;
	/** The socket dropped while live; the next open says so in-band. */
	lost: boolean;
	/** The tab moved onto a new shell; the next open says so in-band. */
	restarted: boolean;
}

export type TerminalLifecycleEvent =
	| {type: "loaded"}
	| {type: "load-failed"}
	| {type: "opened"}
	| {type: "lost"}
	| {type: "exited"}
	| {type: "error"; message: string}
	| {type: "start-failed"; message: string}
	| {type: "reconnect"}
	| {type: "restart"};

export type LinkMessageKind = "lost" | "restored" | "new-shell";

export const INITIAL_TERMINAL_LIFECYCLE: TerminalLifecycle = {
	phase: "loading",
	title: null,
	detail: null,
	lost: false,
	restarted: false,
};

const LOAD_FAILED = "Couldn’t load the terminal. Reload the page to try again.";

function ended(phase: TerminalPhase): boolean {
	return phase === "exited" || phase === "failed" || phase === "load-failed";
}

export function reduceTerminalLifecycle(
	state: TerminalLifecycle,
	event: TerminalLifecycleEvent,
): {state: TerminalLifecycle; link: LinkMessageKind | null} {
	const same = {state, link: null};
	switch (event.type) {
		case "loaded":
			return state.phase === "loading" ? {state: {...state, phase: "connecting"}, link: null} : same;
		case "load-failed":
			return {
				state: {...INITIAL_TERMINAL_LIFECYCLE, phase: "load-failed", title: LOAD_FAILED},
				link: null,
			};
		case "opened": {
			const link = state.lost ? "restored" : state.restarted ? "new-shell" : null;
			return {
				state: {...INITIAL_TERMINAL_LIFECYCLE, phase: "live"},
				link,
			};
		}
		case "lost":
			if (ended(state.phase)) return same;
			if (state.phase === "live") {
				return {state: {...state, phase: "reconnecting", lost: true}, link: "lost"};
			}
			return {state: {...state, phase: "reconnecting"}, link: null};
		case "exited":
			return {
				state: {...INITIAL_TERMINAL_LIFECYCLE, phase: "exited", title: "Shell exited."},
				link: null,
			};
		case "error":
			return {
				state: {
					...INITIAL_TERMINAL_LIFECYCLE,
					phase: "failed",
					title: `Shell disconnected: ${event.message}`,
				},
				link: null,
			};
		case "start-failed":
			return {
				state: {
					...INITIAL_TERMINAL_LIFECYCLE,
					phase: "failed",
					title: "Failed to start shell",
					detail: event.message === "Failed to start shell" ? null : event.message,
				},
				link: null,
			};
		case "reconnect":
			return {state: {...INITIAL_TERMINAL_LIFECYCLE, phase: "connecting"}, link: null};
		case "restart":
			return {
				state: {...INITIAL_TERMINAL_LIFECYCLE, phase: "connecting", restarted: true},
				link: null,
			};
		default:
			return assertNever(event);
	}
}

export type TerminalOverlay =
	| {kind: "placeholder"}
	| {kind: "ended"; title: string; detail: string | null}
	| {kind: "load-failed"; title: string};

export function terminalOverlay(state: TerminalLifecycle): TerminalOverlay | null {
	switch (state.phase) {
		case "loading":
		case "connecting":
			return {kind: "placeholder"};
		case "live":
		case "reconnecting":
			return null;
		case "exited":
		case "failed":
			return {kind: "ended", title: state.title ?? "Shell exited.", detail: state.detail};
		case "load-failed":
			return {kind: "load-failed", title: state.title ?? LOAD_FAILED};
		default:
			return assertNever(state.phase);
	}
}

export type TerminalStatus = "connecting" | "live" | "reconnecting" | "closed" | "error";

export function terminalStatus(state: TerminalLifecycle): TerminalStatus {
	switch (state.phase) {
		case "loading":
		case "connecting":
			return "connecting";
		case "live":
			return "live";
		case "reconnecting":
			return "reconnecting";
		case "exited":
			return "closed";
		case "failed":
		case "load-failed":
			return "error";
		default:
			return assertNever(state.phase);
	}
}

/** Mouse tracking off and back to the normal screen, so the line is readable. */
const RESET_SCREEN_MODES = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1049l";

function dim(text: string): string {
	return `\r\n\x1b[2m${text}\x1b[22m\r\n`;
}

/** Upstream's in-band link lines, written dim (SGR 2) between CRLFs. */
export function formatLinkMessage(kind: LinkMessageKind, host: string): string {
	switch (kind) {
		case "lost":
			return `${RESET_SCREEN_MODES}${dim(`Connection to ${host} lost. Reconnecting…`)}`;
		case "restored":
			return dim("Reconnected.");
		case "new-shell":
			return dim("Reconnected. This is a new shell.");
		default:
			return assertNever(kind);
	}
}
