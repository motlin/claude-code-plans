import {execFileSync, spawn} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

// `just build` runs from `just start` and from every `git test run`, and two
// overlapping builds in one worktree corrupt .output. scripts/with-lock.sh
// serializes them: a second caller waits for the first instead of failing.

const script = join(resolve(process.cwd()), "scripts", "with-lock.sh");

let runDir = "";
let lockDir = "";
let logFile = "";

beforeEach(() => {
	runDir = mkdtempSync(join(tmpdir(), "with-lock-"));
	lockDir = join(runDir, "build.lock");
	logFile = join(runDir, "log");
});

afterEach(() => {
	rmSync(runDir, {recursive: true, force: true});
});

async function runLocked(label: string): Promise<number | null> {
	return new Promise((resolveExit, reject) => {
		const child = spawn(
			"bash",
			[
				script,
				lockDir,
				"bash",
				"-c",
				`echo "${label} start" >> "$0"; sleep 1; echo "${label} end" >> "$0"`,
				logFile,
			],
			{stdio: "ignore"},
		);
		child.once("error", reject);
		child.once("exit", resolveExit);
	});
}

describe("scripts/with-lock.sh", () => {
	it("runs overlapping commands one after another", async () => {
		const exits = await Promise.all([runLocked("a"), runLocked("b")]);
		const lines = readFileSync(logFile, "utf8").trim().split("\n");
		const first = lines[0]?.split(" ")[0] ?? "";
		const second = first === "a" ? "b" : "a";

		expect({exits, lines, lockLeft: existsSync(lockDir)}).toStrictEqual({
			exits: [0, 0],
			lines: [`${first} start`, `${first} end`, `${second} start`, `${second} end`],
			lockLeft: false,
		});
	}, 30_000);

	it("releases the lock and passes the exit status through when the command fails", () => {
		let status: number | null = null;
		try {
			execFileSync("bash", [script, lockDir, "bash", "-c", "exit 3"], {stdio: "ignore"});
		} catch (error) {
			status = (error as {status: number | null}).status;
		}

		expect({status, lockLeft: existsSync(lockDir)}).toStrictEqual({status: 3, lockLeft: false});
	});

	it("reclaims a lock whose holder died without releasing it", () => {
		mkdirSync(lockDir);
		// A pid this high is never live on macOS or Linux defaults.
		writeFileSync(join(lockDir, "pid"), "99999999\n");

		const output = execFileSync("bash", [script, lockDir, "echo", "ran"], {encoding: "utf8", timeout: 10_000});

		expect({output, lockLeft: existsSync(lockDir)}).toStrictEqual({output: "ran\n", lockLeft: false});
	});
});
