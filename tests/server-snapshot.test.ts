import {execFileSync} from "node:child_process";
import {cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	reservePort,
	isolatedServerEnv,
	newServerScriptRun,
	portOwners,
	projectRoot,
	runServerScript,
	type ServerScriptRun,
} from "./helpers/server-script";

// The production server must run from a snapshot of .output outside the
// worktree: `just precommit` rebuilds .output in place, and a server running
// straight from it then 500s when its lazy import()s hit deleted chunks.

const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");

// Each test gets its own project, cache, snapshot root, port and process title
// from the shared helper (beforeEach), so the cases pass in any order and none
// can match a real server.
let serverRun: ServerScriptRun;
let runDir = "";
let projectDir = "";
let snapshotRoot = "";
let env: NodeJS.ProcessEnv = {};

function writeBuild(assets: Record<string, string> = {}): void {
	rmSync(join(projectDir, ".output"), {recursive: true, force: true});
	mkdirSync(join(projectDir, ".output", "server"), {recursive: true});
	mkdirSync(join(projectDir, ".output", "public", "assets"), {recursive: true});
	cpSync(fixture, join(projectDir, ".output", "server", "index.mjs"));
	writeFileSync(join(projectDir, ".output", "nitro.json"), "{}\n");
	for (const [name, content] of Object.entries(assets)) {
		writeFileSync(join(projectDir, ".output", "public", "assets", name), content);
	}
}

function snapshotFiles(snapshot: string, dir: string): Record<string, string> {
	const root = join(snapshotRoot, snapshot, ".output", dir);
	return Object.fromEntries(
		readdirSync(root)
			.toSorted()
			.map((name) => [name, readFileSync(join(root, name), "utf8")]),
	);
}

// Each step has its own timeout, under the test's, so a stall names the step (start, stop, restart) that hung.
// stderr is captured, not inherited, so the deliberate failed start below doesn't print into the test run's output.
async function run(command: string): Promise<string> {
	return runServerScript(command, {env, timeoutMs: 75_000});
}

function listenerCommand(): string {
	const pids = portOwners(env["PORT"] ?? "");
	return execFileSync("ps", ["-o", "command=", "-p", pids.join(",")], {encoding: "utf8", timeout: 10_000}).trim();
}

function snapshots(): string[] {
	return readdirSync(snapshotRoot)
		.filter((name) => name !== "current")
		.toSorted();
}

beforeEach(async () => {
	serverRun = newServerScriptRun("server-snapshot");
	runDir = serverRun.runDir;
	projectDir = join(runDir, "project");
	snapshotRoot = join(runDir, "cache", "claude-code-plans", "server-build");
	mkdirSync(projectDir, {recursive: true});
	writeBuild();
	env = isolatedServerEnv(serverRun, {port: await reservePort(), projectDir});
});

// Sized for stop's own worst case on a loaded machine: SIGTERM, up to STOP_GRACE_SECONDS (10s) of waiting, then
// SIGKILL, with pgrep and netstat each slow under load. The 10s hook default is shorter than the grace period alone.
afterEach(async () => {
	await run("stop");
	rmSync(runDir, {recursive: true, force: true});
}, 60_000);

describe("scripts/server.sh snapshots", () => {
	it("start runs the server from a snapshot outside the worktree's .output", async () => {
		await run("start");
		const [snapshot] = snapshots();
		expect(snapshots()).toHaveLength(1);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, snapshot ?? "", ".output", "server", "index.mjs")}`);
	}, 150_000);

	it("restart reuses the last snapshot even after .output is deleted", async () => {
		await run("start");
		const before = snapshots();
		rmSync(join(projectDir, ".output"), {recursive: true, force: true});
		await run("restart");
		expect(snapshots()).toStrictEqual(before);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, before[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 150_000);

	it("start takes a fresh snapshot and prunes the old one", async () => {
		await run("start");
		const before = snapshots();
		writeBuild();
		await run("start");
		const after = snapshots();
		expect(after).toHaveLength(1);
		expect(after).not.toStrictEqual(before);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, after[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 150_000);

	it("start carries the previous snapshot's hashed assets so open tabs from the old build still load them", async () => {
		writeBuild({"tip-OLD1.js": "old tip", "shared-SAME.js": "shared"});
		await run("start");
		writeBuild({"tip-NEW2.js": "new tip", "shared-SAME.js": "shared"});
		await run("start");
		const [snapshot = ""] = snapshots();

		expect({
			snapshots: snapshots().length,
			assets: snapshotFiles(snapshot, "public/assets"),
			previous: snapshotFiles(snapshot, "previous-assets"),
		}).toStrictEqual({
			snapshots: 1,
			assets: {"shared-SAME.js": "shared", "tip-NEW2.js": "new tip"},
			previous: {"shared-SAME.js": "shared", "tip-OLD1.js": "old tip"},
		});
	}, 150_000);

	it("start keeps only one generation of previous assets", async () => {
		writeBuild({"tip-OLD1.js": "old tip", "shared-SAME.js": "shared"});
		await run("start");
		writeBuild({"tip-NEW2.js": "new tip", "shared-SAME.js": "shared"});
		await run("start");
		writeBuild({"tip-THIRD.js": "third"});
		await run("start");
		const [snapshot = ""] = snapshots();

		expect(snapshotFiles(snapshot, "previous-assets")).toStrictEqual({
			"shared-SAME.js": "shared",
			"tip-NEW2.js": "new tip",
		});
	}, 150_000);

	it("a rebuild of .output leaves the files the running server uses untouched", async () => {
		writeBuild({"tip-OLD1.js": "old tip"});
		await run("start");
		const [snapshot = ""] = snapshots();
		const serverBefore = snapshotFiles(snapshot, "server");
		writeFileSync(join(projectDir, ".output", "server", "index.mjs"), "throw new Error('rebuilt');\n");
		writeFileSync(join(projectDir, ".output", "public", "assets", "tip-OLD1.js"), "rebuilt tip");

		expect({
			snapshots: snapshots(),
			server: snapshotFiles(snapshot, "server"),
			assets: snapshotFiles(snapshot, "public/assets"),
		}).toStrictEqual({
			snapshots: [snapshot],
			server: serverBefore,
			assets: {"tip-OLD1.js": "old tip"},
		});
	}, 150_000);

	it("start keeps the previous snapshot current when the new build never listens", async () => {
		await run("start");
		const before = snapshots();
		writeBuild();
		writeFileSync(join(projectDir, ".output", "server", "index.mjs"), "process.exit(1);\n");

		// start notices the dead build exit, so this doesn't wait out the deadline.
		const failure = await run("start").then(
			() => undefined,
			(error: unknown) => error as {stderr: string},
		);
		expect(failure?.stderr).toBe(
			`Server exited before listening on port ${env["PORT"] ?? ""}; see ${join(runDir, "cache", "claude-code-plans", "server.log")}\nKept snapshot ${before[0] ?? ""} current; 'just restart' serves it again\n`,
		);
		expect({
			current: readFileSync(join(snapshotRoot, "current"), "utf8").trim(),
			kept: before.every((name) => snapshots().includes(name)),
		}).toStrictEqual({current: before[0], kept: true});

		await run("restart");
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, before[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 150_000);

	it("stop finds the snapshot server by its title and entry point", async () => {
		await run("start");
		await run("stop");
		expect(await run("status")).toBe(`No server running (port ${env["PORT"] ?? ""})\n`);
	}, 150_000);
});
