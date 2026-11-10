import {execFile, execFileSync} from "node:child_process";
import {randomInt} from "node:crypto";
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import {promisify} from "node:util";

// Every test that runs scripts/server.sh goes through this helper. The script's
// defaults match the user's real production server (its process title, and its
// snapshot's command line before the rename), so a test using them could
// inspect, and stop, that server. isolatedServerEnv gives each run its own
// title, entry-point pattern, project directory and cache, none of which any
// real server shares.

export const projectRoot = resolve(process.cwd());
export const serverScript = join(projectRoot, "scripts", "server.sh");

/** The title the real production server gives itself (src/lib/server-process-title.ts). */
export const DEFAULT_SERVER_TITLE = "claude-code-browser-server";

/** Escapes a literal for use inside a pgrep (POSIX extended) regular expression. */
export function escapeRegExp(literal: string): string {
	return literal.replaceAll(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`);
}

export interface ServerScriptRun {
	/** A fresh temp directory, realpath'd: lsof reports a process's resolved cwd and server.sh compares it verbatim. */
	readonly runDir: string;
	/** Unique per run; also used as the fake server's command-line marker. */
	readonly instance: string;
	/** A process title no real server has. */
	readonly title: string;
	/** A SERVER_ENTRY_MATCH that only matches entry points under runDir. */
	readonly entryMatch: string;
}

export function newServerScriptRun(prefix: string): ServerScriptRun {
	const runDir = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)));
	const instance = basename(runDir);
	return {
		runDir,
		instance,
		title: `ccb-test-server-${instance}`,
		entryMatch: `${escapeRegExp(runDir)}/.*\\.output/server/index\\.mjs`,
	};
}

/**
 * server.sh's environment for a test run: the caller's base environment with the run's own title, entry-point
 * pattern, project directory (only processes with this cwd are managed) and cache (snapshots and the log), plus
 * `overrides`.
 */
export function isolatedServerEnv(
	run: ServerScriptRun,
	{
		port,
		projectDir = run.runDir,
		base = process.env,
		overrides = {},
	}: {
		port: string;
		projectDir?: string;
		base?: NodeJS.ProcessEnv;
		overrides?: NodeJS.ProcessEnv;
	},
): NodeJS.ProcessEnv {
	const {SERVER_CMD: _cmd, SERVER_MATCH: _match, SNAPSHOT_ROOT: _snapshots, LOG_FILE: _log, ...rest} = base;
	return {
		...rest,
		PORT: port,
		PROJECT_DIR: projectDir,
		XDG_CACHE_HOME: join(run.runDir, "cache"),
		SERVER_TITLE: run.title,
		SERVER_ENTRY_MATCH: run.entryMatch,
		...overrides,
	};
}

// Ports come from a range below every OS's ephemeral range (macOS 49152+, Linux 32768+), so no listen(0) anywhere
// on the machine is ever handed one. Each is claimed with an exclusive lock file naming the claiming pid and held
// until that process exits, so no two test processes, in this file or any other, ever share a port. A port picked
// by listen(0) and released, as before, could be handed to any other process before server.sh bound it.
const RESERVED_PORTS = {first: 20_000, last: 29_999};
const reservationDir = join(tmpdir(), "ccb-test-port-reservations");
const heldReservations = new Set<string>();
let releaseRegistered = false;

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorField(error, "code") === "EPERM";
	}
}

function claimLock(lock: string): boolean {
	try {
		writeFileSync(lock, `${String(process.pid)}\n`, {flag: "wx"});
		return true;
	} catch (error) {
		if (errorField(error, "code") !== "EEXIST") {
			throw error;
		}
	}
	const owner = Number.parseInt(readFileSync(lock, "utf8"), 10);
	if (Number.isInteger(owner) && isAlive(owner)) {
		return false;
	}
	// The claimant died without releasing it.
	rmSync(lock, {force: true});
	try {
		writeFileSync(lock, `${String(process.pid)}\n`, {flag: "wx"});
		return true;
	} catch {
		return false;
	}
}

async function canBind(port: number): Promise<boolean> {
	return new Promise((resolveBindable) => {
		const probe = createServer();
		probe.once("error", () => {
			resolveBindable(false);
		});
		probe.listen(port, () => {
			probe.close(() => {
				resolveBindable(true);
			});
		});
	});
}

function releaseReservations(): void {
	for (const lock of heldReservations) {
		rmSync(lock, {force: true});
	}
	heldReservations.clear();
}

/** A port no other test process holds and nothing is listening on, reserved for this process until it exits. */
export async function reservePort(): Promise<string> {
	mkdirSync(reservationDir, {recursive: true});
	if (!releaseRegistered) {
		releaseRegistered = true;
		process.once("exit", releaseReservations);
	}
	const span = RESERVED_PORTS.last - RESERVED_PORTS.first + 1;
	const offset = randomInt(span);
	for (let index = 0; index < span; index++) {
		const port = RESERVED_PORTS.first + ((offset + index) % span);
		const lock = join(reservationDir, String(port));
		if (!claimLock(lock)) {
			continue;
		}
		if (await canBind(port)) {
			heldReservations.add(lock);
			return String(port);
		}
		// Something outside the tests listens here; leave the port for a later claim to retry.
		rmSync(lock, {force: true});
	}
	throw new Error(`No free port in ${String(RESERVED_PORTS.first)}-${String(RESERVED_PORTS.last)}`);
}

const execFileAsync = promisify(execFile);

/**
 * Runs `server.sh <command>` with its own timeout, under the test's, so a stall fails as "server.sh <command>
 * timed out" with its output so far rather than as a bare test timeout that hides which step hung.
 */
export async function runServerScript(
	command: string,
	{env, cwd = projectRoot, timeoutMs}: {env: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number},
): Promise<string> {
	try {
		const {stdout} = await execFileAsync("bash", [serverScript, command], {
			cwd,
			encoding: "utf8",
			env,
			timeout: timeoutMs,
		});
		return stdout;
	} catch (error) {
		const killed = errorField(error, "killed") === true;
		const stdout = stringField(error, "stdout");
		const stderr = stringField(error, "stderr");
		const what = killed ? `timed out after ${timeoutMs}ms` : "failed";
		throw Object.assign(
			new Error(`server.sh ${command} ${what}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`, {
				cause: error,
			}),
			{stdout, stderr},
		);
	}
}

function errorField(error: unknown, key: string): unknown {
	return typeof error === "object" && error !== null && key in error ? Reflect.get(error, key) : undefined;
}

function stringField(error: unknown, key: string): string {
	const value = errorField(error, key);
	return typeof value === "string" ? value : "";
}

/**
 * PIDs listening on `port`. netstat on macOS, as server.sh does: lsof -i stats every mount point, and a slow NFS or
 * SMB mount stalls it for minutes.
 */
export function portOwners(port: string): string[] {
	if (process.platform === "darwin") {
		return execFileSync("netstat", ["-anv", "-p", "tcp"], {encoding: "utf8", timeout: 10_000})
			.split("\n")
			.map((line) => line.trim().split(/\s+/))
			.filter(
				(fields) =>
					fields[0]?.startsWith("tcp") === true &&
					fields[3]?.endsWith(`.${port}`) === true &&
					fields[5] === "LISTEN",
			)
			.map((fields) => fields[10] ?? "")
			.toSorted();
	}
	try {
		return execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {encoding: "utf8", timeout: 10_000})
			.trim()
			.split("\n")
			.filter(Boolean)
			.toSorted();
	} catch {
		return [];
	}
}

/**
 * Puts a `pgrep` on a PATH directory that only ever reports the given decoy PIDs (those whose command line matches
 * the pattern) and appends each pattern it is asked for to `<dir>/patterns`. server.sh run with this PATH can use
 * its production defaults without seeing any real server.
 */
export function decoyOnlyPgrep(dir: string, decoyPids: readonly number[]): string {
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, "pgrep"),
		[
			"#!/bin/bash",
			'pattern="${!#}"',
			`printf '%s\\n' "$pattern" >>"${join(dir, "patterns")}"`,
			`for pid in ${decoyPids.join(" ")}; do`,
			'    if ps -o command= -p "$pid" 2>/dev/null | grep -Eq -- "$pattern"; then echo "$pid"; fi',
			"done",
			"",
		].join("\n"),
		{mode: 0o755},
	);
	return join(dir, "patterns");
}

/**
 * Times a test's phases against budgets that sum to less than the test's own timeout, so a stall fails as "<phase>
 * did not finish within <budget>" with every phase's start offset and duration, never as a bare test timeout that
 * hides which step hung.
 */
export class PhaseTimer {
	private readonly started = Date.now();
	private readonly lines: string[] = [];

	async step<T>(name: string, budgetMs: number, action: () => Promise<T> | T): Promise<T> {
		const at = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const overBudget = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`${name} did not finish within ${String(budgetMs)}ms`));
			}, budgetMs);
		});
		try {
			const result = await Promise.race([Promise.resolve().then(action), overBudget]);
			// A synchronous action blocks the timer, so check its duration too.
			if (Date.now() - at > budgetMs) {
				throw new Error(`${name} did not finish within ${String(budgetMs)}ms`);
			}
			this.record(name, at, "ok");
			return result;
		} catch (error) {
			this.record(name, at, "FAILED");
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${reason}\n--- phases ---\n${this.report()}`, {cause: error});
		} finally {
			clearTimeout(timer);
		}
	}

	report(): string {
		return this.lines.join("\n");
	}

	private record(name: string, at: number, outcome: string): void {
		const now = Date.now();
		this.lines.push(`+${String(at - this.started)}ms ${name}: ${outcome} in ${String(now - at)}ms`);
	}
}
