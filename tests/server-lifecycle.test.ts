import {type ChildProcess, execFile, execFileSync, execSync, spawn, spawnSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {promisify} from "node:util";
import {afterAll, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	isolatedServerEnv,
	PhaseTimer,
	newServerScriptRun,
	portOwners as listeningPids,
	projectRoot,
	reservePort,
	runServerScript,
	serverScript as script,
} from "./helpers/server-script";

// Regression test for the orphaned duplicate production server
// (.llm/plans/2026-08-08-user-review-bug-sweep.md, step 3): starting the
// server twice must leave exactly one process, and it must own the port.

const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");

// Every test gets its own run: a temp project directory (the only cwd server.sh
// manages), cache, process title, fake-server instance marker and reserved
// port. A process one test leaves behind therefore matches no other test's
// SERVER_MATCH, title, PROJECT_DIR or port, whether the other test is in this
// file or in another file running at the same time. vitest runs this file's
// tests one after another (none is .concurrent); files run in parallel workers.
let runDir = "";
let instance = "";
let MATCH = "";
// The real server renames itself via process.title; the run's own title stands
// in for it so SERVER_MATCH's title alternative can be tested concurrently.
let TITLE = "";
// A run-specific pattern that matches nothing, so the renamed-server tests
// exercise only the title alternative and leave their entry-point decoy alone.
let ENTRY_MATCH = "";
let PORT = "";
let env: NodeJS.ProcessEnv = {};
const runEnvs: NodeJS.ProcessEnv[] = [];

beforeEach(async () => {
	const serverRun = newServerScriptRun("server-lifecycle");
	({runDir, instance} = serverRun);
	MATCH = `fixtures/fake-server\\.mjs ${instance}`;
	TITLE = serverRun.title;
	ENTRY_MATCH = `${instance}/never-matches\\.mjs`;
	PORT = await reservePort();
	env = isolatedServerEnv(serverRun, {
		port: PORT,
		overrides: {
			SERVER_CMD: `node ${fixture} ${instance}`,
			SERVER_MATCH: MATCH,
			LOG_FILE: join(runDir, "server.log"),
		},
	});
	runEnvs.push(env);
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
		return execFileSync("pgrep", ["-f", `^${TITLE}( |$)`], {encoding: "utf8", timeout: 2000})
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		return [];
	}
}

function entryPids(): string[] {
	try {
		return execFileSync("pgrep", ["-f", `${instance}/\\.output/server/index\\.mjs`], {
			encoding: "utf8",
			timeout: 2000,
		})
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
	return listeningPids(PORT);
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

// A safety net: each test stops what it starts.
afterAll(() => {
	for (const runEnv of runEnvs) {
		execFileSync("bash", [script, "stop"], {cwd: projectRoot, encoding: "utf8", env: runEnv});
	}
});

describe("scripts/server.sh", () => {
	it("starting twice leaves exactly one process and it owns the port", () => {
		try {
			run("start");
			const firstPids = serverPids();
			expect(firstPids.length).toBe(1);

			run("start");
			const secondPids = serverPids();
			expect(secondPids.length).toBe(1);
			expect(portOwners()).toStrictEqual(secondPids);
			// The second start replaced the first process rather than piling on.
			expect(secondPids).not.toStrictEqual(firstPids);
		} finally {
			run("stop");
		}
	}, 150_000);

	it("dev refuses to compete with a wildcard-bound production listener", () => {
		try {
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
		} finally {
			run("stop");
		}
	}, 150_000);

	// Each phase has a budget and the budgets sum to under the test's 30s, so a
	// stall fails naming its phase, with every phase's timing, instead of as a
	// bare test timeout.
	it("stop finds a server renamed by process.title via SERVER_MATCH's title alternative", async () => {
		const phases = new PhaseTimer();
		// Listen on a different port so only the command-line match, not the
		// port fallback, can find this process.
		const otherPort = await phases.step("reserve the fixture's port", 2000, reservePort);
		const child = spawn("node", [fixture, instance], {
			cwd: runDir,
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
			env: {...process.env, PORT: otherPort, FAKE_SERVER_TITLE: TITLE},
		});
		// lsof stats mounts and stalled stop for over 15s under load; stop must not need it at all.
		const stalledLsofBin = join(runDir, "stalled-lsof-bin");
		mkdirSync(stalledLsofBin, {recursive: true});
		writeFileSync(join(stalledLsofBin, "lsof"), "#!/bin/sh\nexec sleep 60\n", {mode: 0o755});
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
			expect(
				await phases.step("fixture and decoy ready", 6000, async () =>
					Promise.all([readyLine(child), readyLine(decoy)]),
				),
			).toStrictEqual([`listening on ${otherPort}`, "ready"]);
			expect(await phases.step("pgrep the title before stop", 2000, titledPids)).toStrictEqual([
				String(child.pid),
			]);
			const {SERVER_MATCH: _unused, ...defaultMatchEnv} = env;
			await phases.step("server.sh stop", 15_000, async () =>
				runServerScript("stop", {
					env: {
						...defaultMatchEnv,
						PATH: `${stalledLsofBin}:${process.env["PATH"] ?? ""}`,
						SERVER_TITLE: TITLE,
						SERVER_ENTRY_MATCH: ENTRY_MATCH,
					},
					timeoutMs: 15_000,
				}),
			);
			expect(
				await phases.step("pgrep after stop", 2000, () => ({titled: titledPids(), decoy: entryPids()})),
			).toStrictEqual({titled: [], decoy: [String(decoy.pid)]});
		} finally {
			child.kill("SIGKILL");
			decoy.kill("SIGKILL");
		}
	}, 30_000);

	// A lookup that cannot finish must not read as "no server": stop gives up
	// after LOOKUP_TIMEOUT_SECONDS and fails loudly, stopping nothing. The cwd
	// lookup is a libproc call made through perl on macOS.
	it.skipIf(process.platform !== "darwin")(
		"stop fails loudly when the cwd lookup stalls past LOOKUP_TIMEOUT_SECONDS",
		async () => {
			const phases = new PhaseTimer();
			const otherPort = await phases.step("reserve the fixture's port", 2000, reservePort);
			const child = spawn("node", [fixture, instance], {
				cwd: runDir,
				detached: true,
				stdio: ["ignore", "pipe", "ignore"],
				env: {...process.env, PORT: otherPort, FAKE_SERVER_TITLE: TITLE},
			});
			const fakeBin = join(runDir, "stalled-perl-bin");
			mkdirSync(fakeBin, {recursive: true});
			writeFileSync(join(fakeBin, "perl"), "#!/bin/sh\nexec sleep 60\n", {mode: 0o755});
			try {
				expect(await phases.step("fixture ready", 8000, async () => readyLine(child))).toBe(
					`listening on ${otherPort}`,
				);
				const {SERVER_MATCH: _unused, ...defaultMatchEnv} = env;
				const started = Date.now();
				const failure: unknown = await phases.step("server.sh stop", 15_000, async () =>
					execFileAsync("bash", [script, "stop"], {
						cwd: projectRoot,
						encoding: "utf8",
						timeout: 15_000,
						env: {
							...defaultMatchEnv,
							PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
							SERVER_TITLE: TITLE,
							SERVER_ENTRY_MATCH: ENTRY_MATCH,
							LOOKUP_TIMEOUT_SECONDS: "1",
						},
					}).then(
						() => "stop succeeded",
						(error: unknown) => error,
					),
				);
				expect({
					code: Reflect.get(Object(failure), "code"),
					stdout: Reflect.get(Object(failure), "stdout"),
					stderr: Reflect.get(Object(failure), "stderr"),
					fast: Date.now() - started < 10_000,
					titled: titledPids(),
				}).toStrictEqual({
					code: 1,
					stdout: "",
					stderr: `Reading the cwd of pid(s) ${String(child.pid)} did not finish within 1s\nCould not tell which server processes are running; stopped nothing\n`,
					fast: true,
					titled: [String(child.pid)],
				});
			} finally {
				child.kill("SIGKILL");
			}
		},
		30_000,
	);

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
