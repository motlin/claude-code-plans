import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync} from "node:fs";
import {get, type ClientRequest} from "node:http";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";

// `scripts/server.sh stop` must let the real production server exit on its
// own after SIGTERM. Long-lived handles (file watcher, sweep timers, SSE
// streams, the herdr bridge) used to keep the event loop alive, so every
// stop ended in "Force killing". The script's default SERVER_MATCH is kept:
// the listener closes immediately on SIGTERM, so only the command-line match
// (scoped to this checkout's cwd) sees a process that lingers afterwards.

const projectRoot = resolve(process.cwd());
const script = join(projectRoot, "scripts", "server.sh");
const builtServer = join(projectRoot, ".output", "server", "index.mjs");

// server.sh manages every server whose cwd is PROJECT_DIR, and the user's
// real server runs `node .output/server/index.mjs` from a checkout of this
// repo. Launching from a per-run directory (with .output symlinked in) means
// PROJECT_DIR can only ever match the process this test starts, while the
// script's default SERVER_MATCH still sees a server that lingers after its
// listener closes. realpath because lsof reports the resolved cwd.
const runDir = realpathSync(mkdtempSync(join(tmpdir(), "server-graceful-stop-")));
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

async function freePort(): Promise<string> {
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

function run(command: string): string {
	return execFileSync("bash", [script, command], {
		cwd: appDir,
		encoding: "utf8",
		env,
	});
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
	PORT = await freePort();
	// The server must behave as in production: vitest's VITEST/TEST/NODE_ENV
	// would disable srvx's graceful shutdown and swap in test-only DB paths.
	const {VITEST: _vitest, TEST: _test, NODE_ENV: _nodeEnv, ...baseEnv} = process.env;
	env = {
		...baseEnv,
		PORT,
		HOME: home,
		XDG_CACHE_HOME: join(runDir, "cache"),
		XDG_CONFIG_HOME: join(runDir, "config"),
		HERDR_SOCKET_PATH: join(runDir, "herdr.sock"),
		PROJECT_DIR: appDir,
		LOG_FILE: join(runDir, "server.log"),
		// The assertion is that the server exits on its own after SIGTERM, not how fast: on a loaded machine its
		// shutdown (closing the watcher, waiting out the scan, closing SQLite) can outrun the default 10s grace period
		// that the script then ends with "Force killing". A server held open by a leaked handle never exits, so a
		// long grace period still fails it, just later.
		STOP_GRACE_SECONDS: "45",
		// Likewise startup: under the full parallel suite the built server can take longer than the default 20s to
		// answer its first request, so start would give up on a healthy server.
		START_TIMEOUT_SECONDS: "60",
	};
});

afterAll(() => {
	run("stop");
	rmSync(runDir, {recursive: true, force: true});
});

describe.skipIf(!existsSync(builtServer))("scripts/server.sh with the built server", () => {
	it("stop lets the server exit gracefully instead of force killing it", async () => {
		// Guard: the effective match must not see any existing server (e.g. the
		// user's production server in this checkout) before we start ours.
		expect(appDir).not.toBe(projectRoot);
		expect(run("status")).toBe(`No server running (port ${PORT})\n`);

		let started: string;
		try {
			started = run("start");
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
			const stopped = run("stop");

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
	}, 150_000);
});
