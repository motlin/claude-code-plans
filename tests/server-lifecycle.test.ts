import {type ChildProcess, execFile, execFileSync, execSync, spawn, spawnSync} from "node:child_process";
import {mkdtempSync, realpathSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import {promisify} from "node:util";
import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";

// Regression test for the orphaned duplicate production server
// (.llm/plans/2026-08-08-user-review-bug-sweep.md, step 3): starting the
// server twice must leave exactly one process, and it must own the port.

const projectRoot = resolve(process.cwd());
const script = join(projectRoot, "scripts", "server.sh");
const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");

// Concurrent runs (e.g. several worktrees testing at once) must not share a
// port or see each other's fake servers, so each run gets a free port and a
// unique instance marker on the fake server's command line.
// realpath: lsof reports a process's cwd resolved (/private/var/... on macOS),
// and server.sh compares it to PROJECT_DIR verbatim.
const runDir = realpathSync(mkdtempSync(join(tmpdir(), "server-lifecycle-")));
const instance = basename(runDir);
const MATCH = `fixtures/fake-server\\.mjs ${instance}`;
// The real server renames itself via process.title; this per-run title stands
// in for it so the script's default SERVER_MATCH can be tested concurrently.
const TITLE = `claude-code-browser-server-${instance}`;
// The default SERVER_MATCH also matches any `.output/server/index.mjs` command
// line: the real production server (cwd = this worktree) before it renames
// itself, and other projects' servers, each costing an lsof that can stall for
// minutes under load. This run-specific pattern matches nothing, so the
// default-match test exercises only the title alternative.
const ENTRY_MATCH = `${instance}/never-matches\\.mjs`;

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

beforeAll(async () => {
	PORT = await freePort();
	env = {
		...process.env,
		PORT,
		SERVER_CMD: `node ${fixture} ${instance}`,
		SERVER_MATCH: MATCH,
		// The real server runs with this worktree as its cwd; managing only
		// processes whose cwd is the run directory keeps every test away from it.
		PROJECT_DIR: runDir,
		LOG_FILE: join(runDir, "server.log"),
	};
});

function run(command: string): string {
	return execFileSync("bash", [script, command], {
		cwd: projectRoot,
		encoding: "utf8",
		env,
	});
}

function serverPids(): string[] {
	try {
		return execSync(`pgrep -f '${MATCH}'`, {encoding: "utf8"}).trim().split("\n").filter(Boolean).toSorted();
	} catch {
		return [];
	}
}

function titledPids(): string[] {
	try {
		// macOS pgrep -f sees environment data after a rewritten title, so the
		// title is anchored with ( |$) rather than $.
		return execFileSync("pgrep", ["-f", `^${TITLE}( |$)`], {encoding: "utf8"})
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		return [];
	}
}

function entryPids(): string[] {
	try {
		return execFileSync("pgrep", ["-f", `${instance}/\\.output/server/index\\.mjs`], {encoding: "utf8"})
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		return [];
	}
}

// Resolves once the spawned fixture prints its first line, which it does only
// after setting process.title and starting to listen.
async function readyLine(child: ChildProcess): Promise<string> {
	return new Promise((resolveLine, reject) => {
		let output = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			output += chunk;
			if (output.includes("\n")) {
				resolveLine(output.slice(0, output.indexOf("\n")));
			}
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			reject(new Error(`Fixture exited before it was ready (code ${String(code)}, signal ${String(signal)})`));
		});
	});
}

const execFileAsync = promisify(execFile);

function darwinListeners(): Array<{address: string; processId: string}> {
	return execFileSync("netstat", ["-anv", "-p", "tcp"], {encoding: "utf8"})
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.filter(
			(fields) =>
				fields[0]?.startsWith("tcp") === true &&
				fields[3]?.endsWith(`.${PORT}`) === true &&
				fields[5] === "LISTEN",
		)
		.map((fields) => {
			const address = fields[3];
			const processId = fields[10];
			if (address === undefined || processId === undefined) {
				throw new Error(`Unexpected netstat listener row: ${fields.join(" ")}`);
			}
			return {
				address: `${address.slice(0, -PORT.length - 1)}:${PORT}`,
				processId,
			};
		});
}

function portOwners(): string[] {
	if (process.platform === "darwin") {
		return darwinListeners()
			.map(({processId}) => processId)
			.toSorted();
	}
	try {
		return execFileSync("lsof", ["-nP", "-t", `-iTCP:${PORT}`, "-sTCP:LISTEN"], {
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.filter(Boolean)
			.toSorted();
	} catch {
		return [];
	}
}

function listenerAddresses(): string[] {
	if (process.platform === "darwin") {
		return darwinListeners().map(({address}) => address);
	}
	return execFileSync("lsof", ["-a", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-P", "-n", "-Fn"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((line) => line.startsWith("n"))
		.map((line) => line.slice(1));
}

afterAll(() => {
	run("stop");
});

describe("scripts/server.sh", () => {
	it("starting twice leaves exactly one process and it owns the port", () => {
		run("start");
		const firstPids = serverPids();
		expect(firstPids.length).toBe(1);

		run("start");
		const secondPids = serverPids();
		expect(secondPids.length).toBe(1);
		expect(portOwners()).toStrictEqual(secondPids);
		// The second start replaced the first process rather than piling on.
		expect(secondPids).not.toStrictEqual(firstPids);
	}, 150_000);

	it("dev refuses to compete with a wildcard-bound production listener", () => {
		run("start");
		const productionPids = serverPids();
		expect(productionPids.length).toBe(1);
		expect(portOwners()).toStrictEqual(productionPids);
		expect(listenerAddresses()).toStrictEqual([`*:${PORT}`]);

		const result = spawnSync("bash", [script, "dev", "node", fixture, instance], {
			cwd: projectRoot,
			encoding: "utf8",
			env,
		});

		expect({status: result.status, stdout: result.stdout, stderr: result.stderr}).toStrictEqual({
			status: 1,
			stdout: "",
			stderr: `Port ${PORT} is already in use by pid(s): ${productionPids[0]}. Run 'just stop' before 'just dev'.\n`,
		});
		expect(serverPids()).toStrictEqual(productionPids);
		expect(portOwners()).toStrictEqual(productionPids);
	}, 150_000);

	it("stop finds a server renamed by process.title via the default SERVER_MATCH", async () => {
		// Listen on a different port so only the command-line match, not the
		// port fallback, can find this process.
		const otherPort = await freePort();
		const child = spawn("node", [fixture, instance], {
			cwd: runDir,
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
			env: {...process.env, PORT: otherPort, FAKE_SERVER_TITLE: TITLE},
		});
		// Shaped like an unrenamed production server's command line and sharing
		// PROJECT_DIR as its cwd: stop must leave it alone when SERVER_ENTRY_MATCH
		// says not to match entry points.
		const decoy = spawn(
			"node",
			[
				"-e",
				"console.log('ready'); setInterval(() => {}, 1_000_000)",
				join(runDir, ".output", "server", "index.mjs"),
			],
			{cwd: runDir, detached: true, stdio: ["ignore", "pipe", "ignore"]},
		);
		try {
			expect(await Promise.all([readyLine(child), readyLine(decoy)])).toStrictEqual([
				`listening on ${otherPort}`,
				"ready",
			]);
			expect(titledPids()).toStrictEqual([String(child.pid)]);
			const {SERVER_MATCH: _unused, ...defaultMatchEnv} = env;
			// Async so a slow stop surfaces as this test's timeout rather than
			// blocking the event loop past it.
			await execFileAsync("bash", [script, "stop"], {
				cwd: projectRoot,
				encoding: "utf8",
				env: {...defaultMatchEnv, SERVER_TITLE: TITLE, SERVER_ENTRY_MATCH: ENTRY_MATCH},
			});
			expect({titled: titledPids(), decoy: entryPids()}).toStrictEqual({titled: [], decoy: [String(decoy.pid)]});
		} finally {
			child.kill("SIGKILL");
			decoy.kill("SIGKILL");
		}
	}, 30_000);

	it("start gives up on a server that does not listen within START_TIMEOUT_SECONDS", () => {
		const result = spawnSync("bash", [script, "start"], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {...env, START_TIMEOUT_SECONDS: "1", FAKE_SERVER_LISTEN_DELAY_MS: "5000"},
		});
		run("stop");

		expect({status: result.status, stdout: result.stdout, stderr: result.stderr}).toStrictEqual({
			status: 1,
			stdout: `No server running (port ${PORT})\n`,
			stderr: `Server failed to listen on port ${PORT} within 1s; see ${join(runDir, "server.log")}\n`,
		});
	}, 30_000);

	// On a heavily loaded machine the server can take well over 20s to bind, so
	// the default wait must outlast that; it polls, so a fast start stays fast.
	it("start waits by default for a server that takes longer than 20s to listen", () => {
		const output = execFileSync("bash", [script, "start"], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {...env, FAKE_SERVER_LISTEN_DELAY_MS: "21000"},
		});
		const pids = portOwners();
		run("stop");

		expect(output).toBe(
			`No server running (port ${PORT})\nServer pid ${pids[0] ?? ""} listening on port ${PORT} (log: ${join(runDir, "server.log")})\n`,
		);
	}, 120_000);

	it("start fails fast when the server exits before it listens", () => {
		const started = Date.now();
		const result = spawnSync("bash", [script, "start"], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {...env, SERVER_CMD: `node -e 'process.exit(1)' ${instance}`},
		});
		const elapsedMs = Date.now() - started;

		expect({status: result.status, stderr: result.stderr, fast: elapsedMs < 15_000}).toStrictEqual({
			status: 1,
			stderr: `Server exited before listening on port ${PORT}; see ${join(runDir, "server.log")}\n`,
			fast: true,
		});
	}, 120_000);

	it("start shows what the dead server logged during this launch", () => {
		const result = spawnSync("bash", [script, "start"], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {...env, SERVER_CMD: `node -e 'console.error("boom: EADDRINUSE"); process.exit(1)' ${instance}`},
		});

		expect({status: result.status, stderr: result.stderr}).toStrictEqual({
			status: 1,
			stderr: `Server exited before listening on port ${PORT}; see ${join(runDir, "server.log")}\nboom: EADDRINUSE\n`,
		});
	}, 120_000);

	// The launched pid is only the head of the server's process group: a
	// launcher that forks the real server and exits is not an early exit.
	it("start keeps waiting when the launcher exits but the server it forked lives on", () => {
		const output = execFileSync("bash", [script, "start"], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {
				...env,
				SERVER_CMD: `sh -c 'node ${fixture} ${instance} & exit 0'`,
				FAKE_SERVER_LISTEN_DELAY_MS: "3000",
			},
		});
		const pids = portOwners();
		run("stop");

		expect(output).toBe(
			`No server running (port ${PORT})\nServer pid ${pids[0] ?? ""} listening on port ${PORT} (log: ${join(runDir, "server.log")})\n`,
		);
	}, 120_000);

	it("stop terminates the server and is a no-op when nothing is running", () => {
		run("start");
		run("stop");
		expect(serverPids()).toStrictEqual([]);
		expect(portOwners()).toStrictEqual([]);

		// Stopping again must succeed without error.
		run("stop");
		expect(serverPids()).toStrictEqual([]);
	}, 150_000);
});
