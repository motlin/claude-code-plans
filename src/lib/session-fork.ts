import type {ToastOptions} from "../components/toast";
import {buildClaudeCopyCommand} from "./claude-launch-command";
import {findLaunchedSession, type PendingLaunch} from "./palette-start-session";

/** How long after a fork launch a SessionStart in its directory still counts as the fork. */
export const FORK_NAVIGATION_WINDOW_MS = 60_000;

export function sessionForkArgs(sessionId: string): string[] {
	return ["--resume", sessionId, "--fork-session"];
}

/** The copy-to-clipboard stand-in for the herdr launch. */
export function sessionForkCommand(sessionId: string, cwd: string): string {
	return buildClaudeCopyCommand({cwd, args: sessionForkArgs(sessionId)});
}

/** Why Fork is unavailable, shown as the disabled item's tooltip; null when it can run. */
export function forkDisabledReason({working, cwd}: {working: boolean; cwd: string | null}): string | null {
	if (working) return "Session file is still being written";
	if (cwd === null) return "Session directory is unknown";
	return null;
}

export interface PendingFork extends PendingLaunch {
	parentSessionId: string;
}

export interface ForkDependencies {
	/** herdr is reachable with writes enabled; otherwise the command is copied straight away. */
	herdrWritable: boolean;
	launch: (launch: {cwd: string; args: string[]}) => Promise<{sessionId: string | null}>;
	copy: (text: string) => Promise<boolean>;
	toast: (options: ToastOptions) => void;
	onLaunched: (pending: PendingFork) => void;
	now: () => number;
}

export type ForkOutcome = "launched" | "copied" | "failed";

/**
 * claude.ai/code's one-step Fork: `claude --resume <id> --fork-session` in a
 * new herdr tab, or the same command copied when herdr cannot launch it.
 */
export async function forkSession(
	{sessionId, cwd}: {sessionId: string; cwd: string},
	{herdrWritable, launch, copy, toast, onLaunched, now}: ForkDependencies,
): Promise<ForkOutcome> {
	const args = sessionForkArgs(sessionId);
	if (herdrWritable) {
		const since = now();
		try {
			const launched = await launch({cwd, args});
			onLaunched({cwd, since, sessionId: launched.sessionId, parentSessionId: sessionId});
			return "launched";
		} catch {
			// Fall through to the copied command.
		}
	}

	if (await copy(sessionForkCommand(sessionId, cwd))) {
		toast({
			kind: "success",
			message: "Command copied. Paste it in a terminal to fork this session.",
		});
		return "copied";
	}
	toast({kind: "error", message: "Couldn’t fork the session. Try again."});
	return "failed";
}

interface StartedSession {
	sessionId: string;
	cwd: string;
	startedAt: number;
}

/** The fork a pending launch produced; the parent resuming in the same directory never counts. */
export function findForkedSession(sessions: Iterable<StartedSession>, pending: PendingFork): string | null {
	const candidates = [...sessions].filter(
		(session) =>
			session.sessionId !== pending.parentSessionId &&
			session.startedAt <= pending.since + FORK_NAVIGATION_WINDOW_MS,
	);
	const sessionId = pending.sessionId === pending.parentSessionId ? null : pending.sessionId;
	return findLaunchedSession(candidates, {cwd: pending.cwd, since: pending.since, sessionId});
}

let pendingFork: PendingFork | null = null;
const listeners = new Set<() => void>();

export function setPendingFork(next: PendingFork | null): void {
	pendingFork = next;
	for (const listener of listeners) listener();
}

export function getPendingFork(): PendingFork | null {
	return pendingFork;
}

export function subscribePendingFork(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
