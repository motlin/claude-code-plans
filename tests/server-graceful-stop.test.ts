import {existsSync, mkdirSync, readFileSync, rmSync, symlinkSync} from "node:fs";
import {get, type ClientRequest} from "node:http";
import {join} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";
import {
	reservePort,
	isolatedServerEnv,
	newServerScriptRun,
	projectRoot,
	runServerScript,
} from "./helpers/server-script";

// `scripts/server.sh stop` must let the real production server exit on its
// own after SIGTERM. Long-lived handles (file watcher, sweep timers, SSE
// streams, the herdr bridge) used to keep the event loop alive, so every
// stop ended in "Force killing". SERVER_MATCH is left to the script: the
// listener closes immediately on SIGTERM, so only the title match (scoped to
// the run directory's cwd) sees a process that lingers afterwards.

const builtServer = join(projectRoot, ".output", "server", "index.mjs");

// The shared helper gives the run its own process title (server.sh passes it to
// the server, which renames itself to it), entry-point pattern and cache, so
// the script's matching can never see the user's real server. Launching from a
// per-run directory (with .output symlinked in) means PROJECT_DIR can only ever
// match the process this test starts.
const serverRun = newServerScriptRun("server-graceful-stop");
const {runDir} = serverRun;
const appDir = join(runDir, "app");
mkdirSync(appDir);
if (existsSync(builtServer)) {
	symlinkSync(join(projectRoot, ".output"), join(appDir, ".output"));
}
const home = join(runDir, "home");
for (const directory of ["projects", "plans", "commands", join("plugins", "cache"), "tasks"]) {
	mkdirSync(join(home, ".claude", directory), {recursive: true});
}

let PORT = "";
let env: NodeJS.ProcessEnv = {};

// Each step has its own timeout, under the test's, so a stall names the step (status, start, stop) that hung.
// Sized for the worst cases below: start's 60s START_TIMEOUT_SECONDS, stop's 45s STOP_GRACE_SECONDS.
const stepTimeoutsMs: Record<string, number> = {status: 20_000, start: 80_000, stop: 60_000};

async function run(command: "status" | "start" | "stop"): Promise<string> {
	return runServerScript(command, {env, cwd: appDir, timeoutMs: stepTimeoutsMs[command] ?? 20_000});
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function openEventStream(): Promise<ClientRequest> {
	return new Promise((resolveStream, reject) => {
		const request = get(`http://localhost:${PORT}/api/events`, (response) => {
			response.once("data", () => {
				resolveStream(request);
			});
			response.on("error", () => {});
		});
		request.once("error", reject);
	});
}

/** srvx's graceful-shutdown outcome lines from the server log, without their terminal escapes. */
function shutdownLogLines(): string[] {
	return (
		readFileSync(join(runDir, "server.log"), "utf8")
			.split(/[\r\n]/)
			// oxlint-disable-next-line no-control-regex -- strips terminal color escapes
			.map((line) => line.replaceAll(/\u001B\[[0-9;]*[A-Za-z]/g, "").trim())
			.filter((line) => /^(Server closed successfully|Graceful shutdown timed out|Forcibly closing)/.test(line))
	);
}

beforeAll(async () => {
	PORT = await reservePort();
	// The server must behave as in production: vitest's VITEST/TEST/NODE_ENV
	// would disable srvx's graceful shutdown and swap in test-only DB paths.
	const {VITEST: _vitest, TEST: _test, NODE_ENV: _nodeEnv, ...baseEnv} = process.env;
	env = isolatedServerEnv(serverRun, {
		port: PORT,
		projectDir: appDir,
		base: baseEnv,
		overrides: {
			HOME: home,
			XDG_CONFIG_HOME: join(runDir, "config"),
			HERDR_SOCKET_PATH: join(runDir, "herdr.sock"),
			LOG_FILE: join(runDir, "server.log"),
			// The assertion is that the server exits on its own after SIGTERM, not how fast: on a loaded machine its
			// shutdown (closing the watcher, waiting out the scan, closing SQLite) can outrun the default 10s grace period
			// that the script then ends with "Force killing". A server held open by a leaked handle never exits, so a
			// long grace period still fails it, just later.
			STOP_GRACE_SECONDS: "45",
			// Likewise startup: under the full parallel suite the built server can take longer than the default 20s to
			// answer its first request, so start would give up on a healthy server.
			START_TIMEOUT_SECONDS: "60",
		},
	});
});

// The stop's own 60s timeout fits inside this one; the 10s hook default is shorter than its 45s grace period.
afterAll(async () => {
	await run("stop");
	rmSync(runDir, {recursive: true, force: true});
}, 80_000);

describe.skipIf(!existsSync(builtServer))("scripts/server.sh with the built server", () => {
	it("stop lets the server exit gracefully instead of force killing it", async () => {
		// Guard: the effective match must not see any existing server (e.g. the
		// user's production server in this checkout) before we start ours.
		expect(appDir).not.toBe(projectRoot);
		expect(await run("status")).toBe(`No server running (port ${PORT})\n`);

		let started: string;
		try {
			started = await run("start");
		} catch (error) {
			// afterAll removes runDir, so surface the server's own log while it still exists.
			throw new Error(
				`${String(error)}\n--- server.log ---\n${readFileSync(join(runDir, "server.log"), "utf8")}`,
				{
					cause: error,
				},
			);
		}
		const pid = Number(/^Server pid (\d+) listening/m.exec(started)?.[1]);
		expect(isAlive(pid)).toBe(true);

		// A connected browser tab holds an SSE stream open; startup finishes its
		// initial scan and starts the background sweeps in the meantime.
		const stream = await openEventStream();
		await new Promise((resolveDelay) => {
			setTimeout(resolveDelay, 1500);
		});

		try {
			const stopped = await run("stop");

			// server.sh prints "Force killing" when the process outlives SIGTERM, and srvx logs whether it closed
			// the HTTP server cleanly or gave up waiting on open connections (the SSE stream) and forced them shut.
			expect({stopped, alive: isAlive(pid), shutdownLog: shutdownLogLines()}).toStrictEqual({
				stopped: `Stopping server pid(s): ${pid}\n`,
				alive: false,
				shutdownLog: ["Server closed successfully."],
			});
		} finally {
			stream.destroy();
		}
	}, 180_000);
});
