import {join} from "node:path";

/**
 * herdr's config directory for a release build: `$XDG_CONFIG_HOME/herdr`, else
 * `~/.config/herdr`. Debug builds use `herdr-dev` instead, which ccp never targets.
 */
export function herdrConfigDirectory(env: NodeJS.ProcessEnv = process.env): string {
	const xdgConfigHome = env["XDG_CONFIG_HOME"];
	if (xdgConfigHome) return join(xdgConfigHome, "herdr");
	const home = env["HOME"];
	if (home) return join(home, ".config", "herdr");
	throw new Error("HOME must be set when XDG_CONFIG_HOME is unavailable");
}

/** The JSON API socket of herdr's named session `sessionName`. */
export function herdrNamedSessionSocketPath(sessionName: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(herdrConfigDirectory(env), "sessions", sessionName, "herdr.sock");
}

/**
 * Resolve the JSON API socket used by a release build of herdr.
 *
 * `herdr-client.sock` is a different socket that speaks bincode for the TUI
 * and must never be used for API requests.
 */
export function resolveHerdrSocketPath(env: NodeJS.ProcessEnv = process.env): string {
	const explicitSocketPath = env["HERDR_SOCKET_PATH"];
	if (explicitSocketPath) return explicitSocketPath;

	const sessionName = env["HERDR_SESSION"];
	if (sessionName && sessionName !== "default") return herdrNamedSessionSocketPath(sessionName, env);

	return join(herdrConfigDirectory(env), "herdr.sock");
}
