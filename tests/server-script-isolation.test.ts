import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vite-plus/test";
import {
	DEFAULT_SERVER_TITLE,
	decoyOnlyPgrep,
	escapeRegExp,
	reservePort,
	isolatedServerEnv,
	newServerScriptRun,
	PhaseTimer,
	projectRoot,
	runServerScript,
} from "./helpers/server-script";

// server.sh's defaults match the user's real production server, so no test may
// run it with them except against decoys. These cases prove the shared helper's
// environment can never reach a real server, and check the production defaults
// with a pgrep that only ever reports this file's own decoy processes.

const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");
const run = newServerScriptRun("server-script-isolation");
const children: ChildProcess[] = [];

afterAll(() => {
	for (const child of children) {
		child.kill("SIGKILL");
	}
	rmSync(run.runDir, {recursive: true, force: true});
});

/** Whether `pattern` (as pgrep -f would apply it) matches `commandLine`. */
function grepMatches(pattern: string, commandLine: string): boolean {
	try {
		execFileSync("grep", ["-Eq", "--", pattern], {input: `${commandLine}\n`});
		return true;
	} catch {
		return false;
	}
}

/** Spawns a long-lived process in the run directory and resolves once it prints its first line. */
async function spawnDecoy(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<ChildProcess> {
	const child = spawn("node", args, {cwd: run.runDir, detached: true, stdio: ["ignore", "pipe", "ignore"], env});
	children.push(child);
	await new Promise<void>((resolveReady, reject) => {
		child.stdout.once("data", () => {
			resolveReady();
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			reject(new Error(`Decoy exited before it was ready (code ${String(code)})`));
		});
	});
	return child;
}

/** Whether the child is still running `withinMs` from now; waits on its exit event, so a reaped child is never counted. */
async function aliveAfter(child: ChildProcess, withinMs: number): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return false;
	}
	return new Promise((resolveAlive) => {
		const timer = setTimeout(() => {
			resolveAlive(true);
		}, withinMs);
		child.once("exit", () => {
			clearTimeout(timer);
			resolveAlive(false);
		});
	});
}

const keepAlive = "console.log('ready'); setInterval(() => {}, 1_000_000)";

describe("scripts/server.sh test isolation", () => {
	it("the helper's environment never matches a real server's title or command line", async () => {
		const patterns = decoyOnlyPgrep(join(run.runDir, "helper-pgrep"), []);
		const env = isolatedServerEnv(run, {port: await reservePort()});
		await runServerScript("status", {
			env: {...env, PATH: `${join(run.runDir, "helper-pgrep")}:${process.env["PATH"] ?? ""}`},
			timeoutMs: 20_000,
		});
		const [pattern = ""] = readFileSync(patterns, "utf8").trim().split("\n");
		const home = process.env["HOME"] ?? "/Users/someone";

		expect({
			title: env["SERVER_TITLE"] === DEFAULT_SERVER_TITLE,
			pattern,
			matches: {
				realTitle: grepMatches(pattern, `${DEFAULT_SERVER_TITLE} SHELL=/bin/zsh`),
				realTitleAlone: grepMatches(pattern, DEFAULT_SERVER_TITLE),
				otherProject: grepMatches(pattern, "node .output/server/index.mjs"),
				realSnapshot: grepMatches(
					pattern,
					`node ${home}/.cache/claude-code-plans/server-build/20260101T000000-1/.output/server/index.mjs`,
				),
				ownTitle: grepMatches(pattern, `${run.title} SHELL=/bin/zsh`),
			},
		}).toStrictEqual({
			title: false,
			pattern: `^${run.title}( |$)|${run.entryMatch}`,
			matches: {
				realTitle: false,
				realTitleAlone: false,
				otherProject: false,
				realSnapshot: false,
				ownTitle: true,
			},
		});
	}, 30_000);

	// The one test of the production defaults: no SERVER_TITLE, SERVER_ENTRY_MATCH or SERVER_MATCH. Its pgrep sees
	// only the decoys, so the defaults can't reach the real server even though they would match it.
	it("stop with the production defaults finds a renamed server and its own snapshots, not other projects' servers", async () => {
		const cacheDir = join(run.runDir, "defaults-cache");
		const snapshotEntry = join(
			cacheDir,
			"claude-code-plans",
			"server-build",
			"20260101T000000-1",
			".output",
			"server",
			"index.mjs",
		);
		const titled = await spawnDecoy([fixture, run.instance], {
			...process.env,
			PORT: await reservePort(),
			FAKE_SERVER_TITLE: DEFAULT_SERVER_TITLE,
		});
		const snapshot = await spawnDecoy(["-e", keepAlive, snapshotEntry]);
		const otherProject = await spawnDecoy(["-e", keepAlive, ".output/server/index.mjs"]);
		const pgrepDir = join(run.runDir, "defaults-pgrep");
		const patterns = decoyOnlyPgrep(pgrepDir, [titled.pid ?? -1, snapshot.pid ?? -1, otherProject.pid ?? -1]);
		const {SERVER_TITLE: _title, SERVER_ENTRY_MATCH: _entry, SERVER_MATCH: _match, ...base} = process.env;

		const stopped = await runServerScript("stop", {
			env: {
				...base,
				PATH: `${pgrepDir}:${process.env["PATH"] ?? ""}`,
				PORT: await reservePort(),
				PROJECT_DIR: run.runDir,
				XDG_CACHE_HOME: cacheDir,
				LOG_FILE: join(run.runDir, "defaults.log"),
			},
			timeoutMs: 30_000,
		});

		const expectedPids = [String(titled.pid), String(snapshot.pid)].toSorted();
		expect({
			stopped,
			pattern: readFileSync(patterns, "utf8").trim().split("\n")[0],
			alive: {
				titled: await aliveAfter(titled, 5000),
				snapshot: await aliveAfter(snapshot, 5000),
				otherProject: await aliveAfter(otherProject, 100),
			},
		}).toStrictEqual({
			stopped: `Stopping server pid(s): ${expectedPids.join("\n")}\n`,
			pattern: `^${DEFAULT_SERVER_TITLE}( |$)|${escapeRegExp(join(cacheDir, "claude-code-plans", "server-build"))}/[^/]+/\\.output/server/index\\.mjs`,
			alive: {titled: false, snapshot: false, otherProject: true},
		});
	}, 60_000);
	// A port picked by listen(0) and released could be handed to any process before server.sh binds it, and one
	// test's stop then found another's server on it. Reserved ports sit below every ephemeral range and stay claimed,
	// under a lock file naming this process, until it exits.
	it("reservePort hands out held ports that no listen(0) is ever given", async () => {
		const ports = [await reservePort(), await reservePort()];
		expect(
			ports.map((port) => ({
				belowEphemeral: Number(port) >= 20_000 && Number(port) < 30_000,
				lockOwner: readFileSync(join(tmpdir(), "ccb-test-port-reservations", port), "utf8"),
			})),
		).toStrictEqual([
			{belowEphemeral: true, lockOwner: `${String(process.pid)}\n`},
			{belowEphemeral: true, lockOwner: `${String(process.pid)}\n`},
		]);
		expect(ports[0]).not.toBe(ports[1]);
	});

	// vitest's own timeout names only the test, so the lifecycle tests' phases carry budgets under it.
	it("PhaseTimer fails a phase that overruns its budget, listing every phase so far", async () => {
		const phases = new PhaseTimer();
		await phases.step("quick", 1000, () => "done");
		const failure = await phases
			.step("stalled", 50, async () => new Promise(() => {}))
			.catch((error: unknown) => error);
		const blocking = new PhaseTimer();
		const blocked = await blocking
			.step("blocking", 10, () => {
				const until = Date.now() + 30;
				while (Date.now() < until) {
					// A synchronous step blocks the budget's timer.
				}
			})
			.catch((error: unknown) => error);
		const messages = [failure, blocked].map((error) =>
			error instanceof Error ? error.message.replaceAll(/\d+ms/g, "Nms") : String(error),
		);
		expect(messages).toStrictEqual([
			"stalled did not finish within Nms\n--- phases ---\n+Nms quick: ok in Nms\n+Nms stalled: FAILED in Nms",
			"blocking did not finish within Nms\n--- phases ---\n+Nms blocking: FAILED in Nms",
		]);
	});
});
