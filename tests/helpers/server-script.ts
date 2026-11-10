import {execFile, execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, writeFileSync} from "node:fs";
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

export async function freePort(): Promise<string> {
	return new Promise((resolvePort, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, () => {
			const address = probe.address();
			if (address === null || typeof address === "string") {
				reject(new Error(`Unexpected probe address: ${String(address)}`));
				return;
			}
			probe.close(() => {
				resolvePort(String(address.port));
			});
		});
	});
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
