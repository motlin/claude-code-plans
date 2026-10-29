import {execFileSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";

// The production server must run from a snapshot of .output outside the
// worktree: `just precommit` rebuilds .output in place, and a server running
// straight from it then 500s when its lazy import()s hit deleted chunks.

const projectRoot = resolve(process.cwd());
const script = join(projectRoot, "scripts", "server.sh");
const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");

const runDir = mkdtempSync(join(tmpdir(), "server-snapshot-"));
const projectDir = join(runDir, "project");
const cacheDir = join(runDir, "cache");
const snapshotRoot = join(cacheDir, "claude-code-plans", "server-build");

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

function writeBuild(): void {
	rmSync(join(projectDir, ".output"), {recursive: true, force: true});
	mkdirSync(join(projectDir, ".output", "server"), {recursive: true});
	cpSync(fixture, join(projectDir, ".output", "server", "index.mjs"));
	writeFileSync(join(projectDir, ".output", "nitro.json"), "{}\n");
}

function run(command: string): string {
	return execFileSync("bash", [script, command], {cwd: projectRoot, encoding: "utf8", env});
}

function listenerCommand(): string {
	const port = env["PORT"] ?? "";
	const pid = execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {encoding: "utf8"}).trim();
	return execFileSync("ps", ["-o", "command=", "-p", pid], {encoding: "utf8"}).trim();
}

function snapshots(): string[] {
	return readdirSync(snapshotRoot)
		.filter((name) => name !== "current")
		.toSorted();
}

beforeAll(async () => {
	mkdirSync(projectDir, {recursive: true});
	writeBuild();
	env = {
		...process.env,
		PORT: await freePort(),
		PROJECT_DIR: projectDir,
		XDG_CACHE_HOME: cacheDir,
		SERVER_TITLE: `claude-code-browser-server-${basename(runDir)}`,
	};
	delete env["SERVER_CMD"];
	delete env["SERVER_MATCH"];
	delete env["LOG_FILE"];
});

afterAll(() => {
	run("stop");
	rmSync(runDir, {recursive: true, force: true});
});

describe("scripts/server.sh snapshots", () => {
	it("start runs the server from a snapshot outside the worktree's .output", () => {
		run("start");
		const [snapshot] = snapshots();
		expect(snapshots()).toHaveLength(1);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, snapshot ?? "", ".output", "server", "index.mjs")}`);
	}, 30_000);

	it("restart reuses the last snapshot even after .output is deleted", () => {
		const before = snapshots();
		rmSync(join(projectDir, ".output"), {recursive: true, force: true});
		run("restart");
		expect(snapshots()).toStrictEqual(before);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, before[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 30_000);

	it("start takes a fresh snapshot and prunes the old one", () => {
		const before = snapshots();
		writeBuild();
		run("start");
		const after = snapshots();
		expect(after).toHaveLength(1);
		expect(after).not.toStrictEqual(before);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, after[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 30_000);

	it("stop still finds the snapshot server", () => {
		run("stop");
		expect(run("status")).toBe(`No server running (port ${env["PORT"] ?? ""})\n`);
	}, 30_000);
});
