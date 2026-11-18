import {execFile, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {z} from "zod";

import {HERDR_EVENTS} from "../event-names";
import {hmrPersist} from "../hmr-persist";
import {broadcastTyped} from "../sse-broadcast";
import {HeadlessSession, type HeadlessProcess} from "./session";

/** Persisted so a restarted server can find the CLI processes the previous one left behind. */
const PersistedHeadlessSchema = z.array(
	z.object(
		{
			sessionId: z.string(),
			cwd: z.string(),
			pid: z.number().int().nullable(),
		},
	),
);
type PersistedHeadless = z.infer<typeof PersistedHeadlessSchema>[number];

export interface HeadlessLaunch
{
	cwd: string;
	prompt?: string;
	/** Extra CLI flags (model, mode, effort), already validated by the caller. */
	args?: readonly string[];
}

export interface HeadlessRegistryIo
{
	spawnCli: (args: readonly string[], cwd: string) => HeadlessProcess;
	createSessionId: () => string;
	createRequestId: () => string;
	readState: () => PersistedHeadless[];
	writeState: (entries: PersistedHeadless[]) => void;
	/** The command line of a running pid, or null when no such process runs. */
	processCommand: (pid: number) => Promise<string | null>;
	killPid: (pid: number) => void;
	/** Tell browsers the session list of live panes changed. */
	broadcast: (sessionId: string) => void;
}

/** The CLI flags of an app-owned session: stream-json both ways, permission prompts and dialogs over stdio. */
function headlessCliArgs(sessionId: string, extra: readonly string[] = []): string[]
{
	return [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-prompt-tool",
		"stdio",
		"--session-id",
		sessionId,
		...extra,
	];
}

/**
 * The app's headless sessions by session id. Each launch spawns and owns one
 * CLI process for the life of the session; its exit (or crash) marks the
 * session ended and drops it from the live list.
 */
export class HeadlessRegistry
{
	private readonly sessions = new Map<string, HeadlessSession>();

	constructor(private readonly io: HeadlessRegistryIo)
	{
	}

	launch({cwd, prompt, args = []}: HeadlessLaunch): HeadlessSession
	{
		const sessionId = this.io.createSessionId();
		const child = this.io.spawnCli(headlessCliArgs(sessionId, args), cwd);
		const session = new HeadlessSession(
			{
				sessionId,
				cwd,
				process: child,
				createRequestId: this.io.createRequestId,
				onChange: (changed) =>
				{
					if (changed.status === "ended" && this.sessions.get(changed.sessionId) === changed)
					{
						this.sessions.delete(changed.sessionId);
						this.persist();
					}
					this.io.broadcast(changed.sessionId);
				},
			},
		);
		this.sessions.set(sessionId, session);
		this.persist();
		session.start(prompt);
		return session;
	}

	/** The live session, or undefined when the id is not a running headless session. */
	get(sessionId: string): HeadlessSession | undefined
	{
		return this.sessions.get(sessionId);
	}

	list(): HeadlessSession[]
	{
		return [...this.sessions.values()];
	}

	/** Server shutdown: close every session's stdin so each CLI finishes and exits. */
	closeAll(): void
	{
		for (const session of this.sessions.values()) session.close();
	}

	/**
	 * Server start: the previous server's sessions cannot be re-adopted (their
	 * stdio pipes died with it), so each is marked ended. A CLI still running
	 * under its recorded pid with its own `--session-id` is stopped, as nothing
	 * can answer its prompts any more. Returns the ended session ids.
	 */
	async recoverAfterRestart(): Promise<string[]>
	{
		const previous = this.io.readState();
		for (const entry of previous)
		{
			if (entry.pid === null) continue;
			const command = await this.io.processCommand(entry.pid);
			if (command?.includes(`--session-id ${entry.sessionId}`) === true) this.io.killPid(entry.pid);
		}
		this.persist();
		return previous.map((entry) => entry.sessionId);
	}

	private persist(): void
	{
		this.io.writeState(
			this.list().map((session) => (
			{
				sessionId: session.sessionId,
				cwd: session.cwd,
				pid: session.pid ?? null,
			})),
		);
	}
}

/** A spawned `claude` child as a {@link HeadlessProcess}: stdout split into lines, stderr ignored. */
function spawnHeadlessCli(args: readonly string[], cwd: string): HeadlessProcess
{
	const child = spawn(
		"claude",
		args,
		{
			cwd,
			stdio: ["pipe", "pipe", "ignore"],
			env: process.env,
		},
	);
	// A spawn failure surfaces through "error"; a write after exit must not crash the server.
	child.stdin.on("error", () => undefined);
	const lineListeners: ((line: string) => void)[] = [];
	const exitListeners: ((exit: {code: number | null; signal: string | null; error: string | null}) => void)[] = [];
	let tail = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) =>
	{
		const lines = (tail + chunk).split("\n");
		tail = lines.pop() ?? "";
		for (const line of lines)
		{
			if (line.trim() === "") continue;
			for (const listener of lineListeners) listener(line);
		}
	});
	let exited = false;
	const finish = (exit: {code: number | null; signal: string | null; error: string | null}) =>
	{
		if (exited) return;
		exited = true;
		for (const listener of exitListeners) listener(exit);
	};
	child.on("close", (code, signal) =>
	{
		finish(
			{
				code,
				signal,
				error: null,
			},
		);
	});
	child.on("error", (error) =>
	{
		finish(
			{
				code: null,
				signal: null,
				error: error.message,
			},
		);
	});
	return {
		pid: child.pid,
		write: (line) =>
		{
			if (child.stdin.writable) child.stdin.write(`${line}\n`);
		},
		end: () =>
		{
			child.stdin.end();
		},
		kill: () =>
		{
			child.kill("SIGTERM");
		},
		onLine: (listener) =>
		{
			lineListeners.push(listener);
		},
		onExit: (listener) =>
		{
			exitListeners.push(listener);
		},
	};
}

async function psCommand(pid: number): Promise<string | null>
{
	return new Promise((resolve) =>
	{
		execFile("ps", ["-o", "command=", "-p", String(pid)], (error, stdout) =>
		{
			resolve(error === null ? stdout.trim() : null);
		});
	});
}

function fileState(path: string): Pick<HeadlessRegistryIo, "readState" | "writeState">
{
	return {
		readState: () =>
		{
			try
			{
				return PersistedHeadlessSchema.parse(JSON.parse(readFileSync(path, "utf8")));
			}
			catch
			{
				return [];
			}
		},
		writeState: (entries) =>
		{
			try
			{
				writeFileSync(path, JSON.stringify(entries));
			}
			catch (error)
			{
				console.error("Failed to persist headless sessions:", error);
			}
		},
	};
}

function nodeHeadlessRegistryIo(statePath: string | null, broadcast: (sessionId: string) => void): HeadlessRegistryIo
{
	return {
		spawnCli: spawnHeadlessCli,
		createSessionId: () => randomUUID(),
		createRequestId: () => `ccp:headless:${randomUUID()}`,
		...(statePath === null
			?
				{
					readState: () => [],
					writeState: () => undefined,
				}
			: fileState(statePath)),
		processCommand: psCommand,
		killPid: (pid) =>
		{
			try
			{
				process.kill(pid, "SIGTERM");
			}
			catch
			{
				// Already gone.
			}
		},
		broadcast,
	};
}

const holder = hmrPersist<
{
	registry: HeadlessRegistry | null;
}>("headlessRegistry", () => (
{
	registry: null,
}));

/** The server's registry, created on first use (without persistence until `initHeadlessRegistry`). */
export function getHeadlessRegistry(): HeadlessRegistry
{
	holder.registry ??= new HeadlessRegistry(nodeHeadlessRegistryIo(null, broadcastHeadlessChange));
	return holder.registry;
}

/** Server start: persist live sessions to `statePath` and end the ones a previous server left behind. */
export async function initHeadlessRegistry(statePath: string): Promise<string[]>
{
	const registry = new HeadlessRegistry(nodeHeadlessRegistryIo(statePath, broadcastHeadlessChange));
	const previous = holder.registry;
	holder.registry = registry;
	previous?.closeAll();
	return registry.recoverAfterRestart();
}

/** Browsers refetch their pane list on any herdr pane event, so a headless change rides the same one. */
function broadcastHeadlessChange(sessionId: string): void
{
	broadcastTyped(
		HERDR_EVENTS.PANE_UPDATED,
		{
			paneId: headlessPaneId(sessionId),
		},
	);
}

/** The pseudo pane id a headless session is listed under. */
export function headlessPaneId(sessionId: string): string
{
	return `headless:${sessionId}`;
}
