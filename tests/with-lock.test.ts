import {execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
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
const holders: number[] = [];

beforeEach(() => {
	runDir = mkdtempSync(join(tmpdir(), "with-lock-"));
	lockDir = join(runDir, "build.lock");
	logFile = join(runDir, "log");
});

afterEach(() => {
	for (const pid of holders.splice(0)) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
	rmSync(runDir, {recursive: true, force: true});
});

async function runLocked(label: string, seconds: number): Promise<number | null> {
	return new Promise((resolveExit, reject) => {
		const child = spawn(
			"bash",
			[
				script,
				lockDir,
				"bash",
				"-c",
				`echo "${label} start" >> "$0"; sleep ${seconds}; echo "${label} end" >> "$0"`,
				logFile,
			],
			{stdio: "ignore"},
		);
		child.once("error", reject);
		child.once("exit", resolveExit);
	});
}

// Each command's start must be followed by its own end: any other line in
// between means two commands were inside the lock at once.
function overlaps(lines: string[]): string[] {
	const found: string[] = [];
	for (let i = 0; i < lines.length; i += 2) {
		const label = lines[i]?.split(" ")[0] ?? "";
		if (lines[i] !== `${label} start` || lines[i + 1] !== `${label} end`) {
			found.push(`${lines[i]} / ${lines[i + 1]}`);
		}
	}
	return found;
}

// Takes the lock with a long-running command in its own process group, then
// SIGKILLs the whole group so the holder dies without any chance to release.
async function killHolder(): Promise<void> {
	const holder = spawn("bash", [script, lockDir, "bash", "-c", `echo held > "$0"; sleep 30`, `${logFile}.held`], {
		stdio: "ignore",
		detached: true,
	});
	const pid = holder.pid ?? 0;
	holders.push(pid);
	const exited = new Promise((resolveExit) => {
		holder.once("exit", resolveExit);
	});
	const deadline = Date.now() + 10_000;
	while (!existsSync(`${logFile}.held`)) {
		if (Date.now() > deadline) throw new Error("holder never took the lock");
		await new Promise((resolveWait) => {
			setTimeout(resolveWait, 20);
		});
	}
	process.kill(-pid, "SIGKILL");
	await exited;
}

describe("scripts/with-lock.sh", () => {
	it("runs overlapping commands one after another", async () => {
		const exits = await Promise.all([runLocked("a", 1), runLocked("b", 1)]);
		const lines = readFileSync(logFile, "utf8").trim().split("\n");
		const first = lines[0]?.split(" ")[0] ?? "";
		const second = first === "a" ? "b" : "a";

		expect({exits, lines}).toStrictEqual({
			exits: [0, 0],
			lines: [`${first} start`, `${first} end`, `${second} start`, `${second} end`],
		});
	}, 30_000);

	it("never lets two of many waiters in at once after the holder was killed", async () => {
		// The pid-file lock let every waiter that saw the dead holder "reclaim"
		// the lock, deleting a fresh lock another waiter had just taken.
		const results: {exits: (number | null)[]; overlaps: string[]}[] = [];
		for (let round = 0; round < 6; round++) {
			rmSync(logFile, {force: true});
			await killHolder();
			const labels = Array.from({length: 10}, (_, i) => `w${i}`);
			const exits = await Promise.all(labels.map(async (label) => runLocked(label, 0.05)));
			results.push({exits, overlaps: overlaps(readFileSync(logFile, "utf8").trim().split("\n"))});
		}

		expect(results).toStrictEqual(Array.from({length: 6}, () => ({exits: Array(10).fill(0), overlaps: []})));
	}, 120_000);

	it("releases the lock and passes the exit status through when the command fails", () => {
		let status: number | null = null;
		try {
			execFileSync("bash", [script, lockDir, "bash", "-c", "exit 3"], {stdio: "ignore"});
		} catch (error) {
			status = (error as {status: number | null}).status;
		}
		const next = execFileSync("bash", [script, lockDir, "echo", "ran"], {encoding: "utf8", timeout: 5000});

		expect({status, next}).toStrictEqual({status: 3, next: "ran\n"});
	});

	it("lets the next caller in at once when the holder was killed without releasing", async () => {
		await killHolder();
		const started = Date.now();
		const output = execFileSync("bash", [script, lockDir, "echo", "ran"], {encoding: "utf8", timeout: 10_000});

		expect({output, prompt: Date.now() - started < 5000}).toStrictEqual({output: "ran\n", prompt: true});
	}, 30_000);
});
