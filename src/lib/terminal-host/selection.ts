import {execFile} from "node:child_process";
import {getActiveSessionEntries} from "../active-session-store";
import {probeAnyHerdr} from "../herdr/availability";
import {discoverLiveHerdrServers} from "../herdr/servers";
import {hmrPersist} from "../hmr-persist";
import {nonEmpty} from "../non-empty";
import type {TerminalHostSetting} from "../terminal-host-setting";

/** A terminal multiplexer ccp can drive. */
export type TerminalHostId = "herdr" | "tmux";

export interface TerminalHostProbes {
	/** Whether any herdr server's API socket (default or a named session) answers a ping. */
	herdrAvailable: () => Promise<boolean>;
	/** Whether this process runs inside tmux or a tmux server is up. */
	tmuxAvailable: () => Promise<boolean>;
}

/**
 * Resolve the Terminal host setting to one host. An explicit choice is taken as
 * is. `auto` prefers herdr when its socket answers, else tmux when present.
 * With neither running it stays on herdr: herdr's own "not running" handling
 * (empty pane lists, failed writes) is the long-standing answer for that case.
 */
export async function selectTerminalHost(
	setting: TerminalHostSetting,
	probes: TerminalHostProbes,
): Promise<TerminalHostId> {
	if (setting !== "auto") return setting;
	if (await probes.herdrAvailable()) return "herdr";
	if (await probes.tmuxAvailable()) return "tmux";
	return "herdr";
}

/** Runs inside tmux (`$TMUX` set), or a tmux server answers. */
export async function detectTmux(
	env: NodeJS.ProcessEnv = process.env,
	serverRunning: () => Promise<boolean> = tmuxServerRunning,
): Promise<boolean> {
	if (nonEmpty(env["TMUX"]) !== undefined) return true;
	return serverRunning();
}

const TMUX_PROBE_TIMEOUT_MS = 1500;
const TMUX_CACHE_TTL_MS = 30_000;

const tmuxCache = hmrPersist<{expiresAt: number; running: boolean}>("tmuxServerRunning", () => ({
	expiresAt: 0,
	running: false,
}));

/** `tmux list-sessions` exits non-zero with "no server running"; cached like the herdr probe. */
async function tmuxServerRunning(): Promise<boolean> {
	const now = Date.now();
	if (now < tmuxCache.expiresAt) return tmuxCache.running;
	const running = await new Promise<boolean>((resolve) => {
		execFile("tmux", ["list-sessions"], {timeout: TMUX_PROBE_TIMEOUT_MS}, (error) => {
			resolve(error === null);
		});
	});
	tmuxCache.running = running;
	tmuxCache.expiresAt = Date.now() + TMUX_CACHE_TTL_MS;
	return running;
}

export const defaultTerminalHostProbes: TerminalHostProbes = {
	herdrAvailable: async () =>
		probeAnyHerdr(
			discoverLiveHerdrServers(getActiveSessionEntries().map((entry) => entry.herdrSocketPath)).map(
				(server) => server.socketPath,
			),
		),
	tmuxAvailable: async () => detectTmux(),
};
