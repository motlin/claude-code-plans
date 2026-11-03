import {execFileSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {basename, join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

// The production server must run from a snapshot of .output outside the
// worktree: `just precommit` rebuilds .output in place, and a server running
// straight from it then 500s when its lazy import()s hit deleted chunks.

const projectRoot = resolve(process.cwd());
const script = join(projectRoot, "scripts", "server.sh");
const fixture = join(projectRoot, "tests", "fixtures", "fake-server.mjs");

// Each test gets its own project, cache, snapshot root and port (beforeEach),
// so the cases pass in any order.
let runDir = "";
let projectDir = "";
let snapshotRoot = "";
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

beforeEach(async () => {
	runDir = mkdtempSync(join(tmpdir(), "server-snapshot-"));
	projectDir = join(runDir, "project");
	const cacheDir = join(runDir, "cache");
	snapshotRoot = join(cacheDir, "claude-code-plans", "server-build");
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

afterEach(() => {
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
		run("start");
		const before = snapshots();
		rmSync(join(projectDir, ".output"), {recursive: true, force: true});
		run("restart");
		expect(snapshots()).toStrictEqual(before);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, before[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 30_000);

	it("start takes a fresh snapshot and prunes the old one", () => {
		run("start");
		const before = snapshots();
		writeBuild();
		run("start");
		const after = snapshots();
		expect(after).toHaveLength(1);
		expect(after).not.toStrictEqual(before);
		expect(listenerCommand()).toBe(`node ${join(snapshotRoot, after[0] ?? "", ".output", "server", "index.mjs")}`);
	}, 30_000);

	it("start carries the previous snapshot's hashed assets so open tabs from the old build still load them", () => {
		writeBuild({"tip-OLD1.js": "old tip", "shared-SAME.js": "shared"});
		run("start");
		writeBuild({"tip-NEW2.js": "new tip", "shared-SAME.js": "shared"});
		run("start");
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
	}, 60_000);

	it("start keeps only one generation of previous assets", () => {
		writeBuild({"tip-OLD1.js": "old tip", "shared-SAME.js": "shared"});
		run("start");
		writeBuild({"tip-NEW2.js": "new tip", "shared-SAME.js": "shared"});
		run("start");
		writeBuild({"tip-THIRD.js": "third"});
		run("start");
		const [snapshot = ""] = snapshots();

		expect(snapshotFiles(snapshot, "previous-assets")).toStrictEqual({
			"shared-SAME.js": "shared",
			"tip-NEW2.js": "new tip",
		});
	}, 60_000);

	it("stop still finds the snapshot server", () => {
		run("start");
		run("stop");
		expect(run("status")).toBe(`No server running (port ${env["PORT"] ?? ""})\n`);
	}, 30_000);
});
