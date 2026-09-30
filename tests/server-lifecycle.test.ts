import {execFileSync, execSync, spawn, spawnSync} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
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
const runDir = mkdtempSync(join(tmpdir(), "server-lifecycle-"));
const instance = basename(runDir);
const MATCH = `fixtures/fake-server\\.mjs ${instance}`;
// The real server renames itself via process.title; this per-run title stands
// in for it so the script's default SERVER_MATCH can be tested concurrently.
const TITLE = `claude-code-browser-server-${instance}`;

let PORT = "";
let env: NodeJS.ProcessEnv = {};

function freePort(): Promise<string> {
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
		return execSync(`pgrep -f '${MATCH}'`, {encoding: "utf8"}).trim().split("\n").filter(Boolean).sort();
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

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) {
			return;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error("Timed out waiting for condition");
}

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
			.sort();
	}
	try {
		return execFileSync("lsof", ["-nP", "-t", `-iTCP:${PORT}`, "-sTCP:LISTEN"], {
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.filter(Boolean)
			.sort();
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
	}, 30_000);

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
	}, 30_000);

	it("stop finds a server renamed by process.title via the default SERVER_MATCH", async () => {
		// Listen on a different port so only the command-line match, not the
		// port fallback, can find this process.
		const otherPort = await freePort();
		const child = spawn("node", [fixture, instance], {
			cwd: projectRoot,
			detached: true,
			stdio: "ignore",
			env: {...process.env, PORT: otherPort, FAKE_SERVER_TITLE: TITLE},
		});
		child.unref();
		try {
			await waitFor(() => titledPids().length === 1);
			const {SERVER_MATCH: _unused, ...defaultMatchEnv} = env;
			execFileSync("bash", [script, "stop"], {
				cwd: projectRoot,
				encoding: "utf8",
				env: {...defaultMatchEnv, SERVER_TITLE: TITLE},
			});
			expect(titledPids()).toStrictEqual([]);
		} finally {
			child.kill("SIGKILL");
		}
	}, 30_000);

	it("stop terminates the server and is a no-op when nothing is running", () => {
		run("start");
		run("stop");
		expect(serverPids()).toStrictEqual([]);
		expect(portOwners()).toStrictEqual([]);

		// Stopping again must succeed without error.
		run("stop");
		expect(serverPids()).toStrictEqual([]);
	}, 30_000);
});
