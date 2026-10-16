import {execFile} from "node:child_process";
import {buildClaudeCopyCommand} from "../claude-launch-command";
import type {HerdrResult} from "../herdr/client";
import type {HerdrLaunchResult, LaunchClaudeRequest} from "../herdr/launch";
import {errorMessage} from "../narrow";

/** Runs `tmux <args>` on the default server and resolves its stdout; rejects when tmux fails. */
export interface TmuxLaunchIo {
	output: (args: readonly string[]) => Promise<string>;
}

/** The detached session ccp launches into when no client is attached. */
const TMUX_LAUNCH_FALLBACK_SESSION = "claude";

export interface TmuxLaunchTarget {
	session: string;
	/** false: the fallback session must be created. */
	exists: boolean;
}

const PRINT_IDS = ["-P", "-F", "#{window_id}\t#{pane_id}"];

async function outputOrEmpty(io: TmuxLaunchIo, args: readonly string[]): Promise<string> {
	try {
		return await io.output(args);
	} catch {
		// No tmux server running: nothing attached and no sessions.
		return "";
	}
}

/** The session of the client with the highest `client_activity`, or null with no client attached. */
function mostRecentClientSession(stdout: string): string | null {
	let best: {activity: number; session: string} | null = null;
	for (const line of stdout.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab === -1) continue;
		const activity = Number.parseInt(line.slice(0, tab), 10);
		const session = line.slice(tab + 1);
		if (Number.isNaN(activity) || session === "") continue;
		if (best === null || activity > best.activity) best = {activity, session};
	}
	return best?.session ?? null;
}

/**
 * Where a new window goes: the session of the most recently active client,
 * else the detached `claude` session, which is created when it is missing.
 */
export async function chooseTmuxLaunchSession(io: TmuxLaunchIo): Promise<TmuxLaunchTarget> {
	const clients = await outputOrEmpty(io, ["list-clients", "-F", "#{client_activity}\t#{client_session}"]);
	const session = mostRecentClientSession(clients);
	if (session !== null) return {session, exists: true};
	const sessions = await outputOrEmpty(io, ["list-sessions", "-F", "#{session_name}"]);
	return {
		session: TMUX_LAUNCH_FALLBACK_SESSION,
		exists: sessions.split("\n").includes(TMUX_LAUNCH_FALLBACK_SESSION),
	};
}

function failure(code: string, message: string): HerdrResult<never> {
	return {ok: false, code, message};
}

/**
 * Start `claude` in a new detached tmux window. tmux runs the command through
 * the user's shell, so it is the same quoted command line as the copy
 * fallback; the prompt rides along as the CLI's positional argument.
 */
export async function launchClaudeInTmux(
	{cwd, prompt, args = []}: LaunchClaudeRequest,
	io: TmuxLaunchIo,
): Promise<HerdrResult<HerdrLaunchResult>> {
	const command = buildClaudeCopyCommand({args, ...(prompt === undefined ? {} : {prompt})});
	try {
		const target = await chooseTmuxLaunchSession(io);
		const create = target.exists
			? ["new-window", "-d", "-t", `${target.session}:`]
			: ["new-session", "-d", "-s", target.session];
		const stdout = await io.output([...create, "-c", cwd, ...PRINT_IDS, command]);
		const [tabId, paneId] = stdout.trim().split("\t");
		if (!tabId?.startsWith("@") || !paneId?.startsWith("%")) {
			return failure("bad-response", "tmux did not print the new window's ids");
		}
		return {ok: true, value: {tabId, paneId, sessionId: null}};
	} catch (error) {
		return failure("tmux-failed", errorMessage(error));
	}
}

const TMUX_LAUNCH_TIMEOUT_MS = 5000;

export const defaultTmuxLaunchIo: TmuxLaunchIo = {
	output: async (args) =>
		new Promise((resolve, reject) => {
			execFile("tmux", [...args], {timeout: TMUX_LAUNCH_TIMEOUT_MS}, (error: Error | null, stdout: string) => {
				if (error) reject(error);
				else resolve(stdout);
			});
		}),
};
