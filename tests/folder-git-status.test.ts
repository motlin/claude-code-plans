import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {homeFolderStatusQueryOptions} from "../src/lib/api/home-folder-status";
import {folderStatusResponse, parseFolderGitStatus, readFolderGitStatus} from "../src/lib/folder-git-status";

const NOT_A_REPO = {isGitRepo: false, headBranch: null, defaultBranch: null, uncommittedFiles: 0};

describe("parseFolderGitStatus", () => {
	it("counts one uncommitted file per porcelain line", () => {
		expect(
			parseFolderGitStatus({
				head: "feat/x\n",
				originHead: "origin/main\n",
				porcelain: " M a.ts\n?? b.ts\nA  c.ts\n",
			}),
		).toStrictEqual({isGitRepo: true, headBranch: "feat/x", defaultBranch: "main", uncommittedFiles: 3});
	});

	it("reads a detached HEAD as no branch", () => {
		expect(parseFolderGitStatus({head: "HEAD\n", originHead: "origin/main\n", porcelain: ""})).toStrictEqual({
			isGitRepo: true,
			headBranch: null,
			defaultBranch: "main",
			uncommittedFiles: 0,
		});
	});

	it("has no default branch when origin/HEAD is unset", () => {
		expect(parseFolderGitStatus({head: "main\n", originHead: null, porcelain: ""})).toStrictEqual({
			isGitRepo: true,
			headBranch: "main",
			defaultBranch: null,
			uncommittedFiles: 0,
		});
	});

	it("is not a git repo when rev-parse failed", () => {
		expect(parseFolderGitStatus({head: null, originHead: null, porcelain: null})).toStrictEqual(NOT_A_REPO);
	});
});

describe("folderStatusResponse", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = realpathSync(mkdtempSync(join(tmpdir(), "folder-git-status-test-")));
	});

	afterEach(() => {
		rmSync(tempDir, {recursive: true, force: true});
	});

	async function get(path: string | null, exec?: Parameters<typeof folderStatusResponse>[1]): Promise<Response> {
		const url = new URL("http://localhost/api/home/folder-status");
		if (path !== null) url.searchParams.set("path", path);
		return folderStatusResponse(new Request(url), exec);
	}

	it("returns the strict shape from an injected exec, running only read-only git commands in the folder", async () => {
		const calls: {args: readonly string[]; cwd: string}[] = [];
		const response = await get(tempDir, async (_file, args, options) => {
			await Promise.resolve();
			calls.push({args, cwd: options.cwd});
			if (args.includes("rev-parse")) return "feat/x\n";
			if (args.includes("symbolic-ref")) return "origin/main\n";
			return " M a.ts\n";
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toStrictEqual({
			isGitRepo: true,
			headBranch: "feat/x",
			defaultBranch: "main",
			uncommittedFiles: 1,
		});
		expect(calls.map((c) => c.cwd)).toStrictEqual([tempDir, tempDir, tempDir]);
		expect(calls.map((c) => c.args.filter((a) => !a.startsWith("core.")).slice(1))).toStrictEqual([
			["rev-parse", "--abbrev-ref", "HEAD"],
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			["status", "--porcelain=v1", "--untracked-files=normal"],
		]);
	});

	it("rejects a relative path with 400", async () => {
		const response = await get("projects/foo");
		expect(response.status).toBe(400);
	});

	it("rejects a missing path with 400", async () => {
		expect((await get(null)).status).toBe(400);
	});

	it("rejects a path with .. segments with 400", async () => {
		expect((await get(`${tempDir}/../${tempDir.split("/").at(-1) ?? ""}`)).status).toBe(400);
	});

	it("rejects a file path with 400 without running git", async () => {
		const file = join(tempDir, "secret.txt");
		writeFileSync(file, "secret");
		let ran = false;
		const response = await get(file, async () => {
			await Promise.resolve();
			ran = true;
			return "";
		});
		expect(response.status).toBe(400);
		expect(ran).toBe(false);
	});

	it("rejects a directory that does not exist with 400", async () => {
		expect((await get(join(tempDir, "nope"))).status).toBe(400);
	});

	it("reports a plain directory as not a git repo", async () => {
		expect(await readFolderGitStatus(tempDir)).toStrictEqual(NOT_A_REPO);
	});

	it("reads a real temp git repo: branch, origin default and uncommitted files", async () => {
		const origin = join(tempDir, "origin");
		const work = join(tempDir, "work");
		mkdirSync(origin);
		const git = (cwd: string, ...args: string[]): string =>
			execFileSync(
				"git",
				["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args],
				{
					cwd,
					encoding: "utf-8",
				},
			);
		git(origin, "init", "-q");
		writeFileSync(join(origin, "README"), "hi");
		git(origin, "add", "README");
		git(origin, "commit", "-q", "-m", "init");
		git(tempDir, "clone", "-q", origin, work);
		git(work, "switch", "-q", "-c", "feat/x");
		writeFileSync(join(work, "README"), "changed");
		writeFileSync(join(work, "new-1.txt"), "a");
		writeFileSync(join(work, "new-2.txt"), "b");

		expect(await readFolderGitStatus(work)).toStrictEqual({
			isGitRepo: true,
			headBranch: "feat/x",
			defaultBranch: "main",
			uncommittedFiles: 3,
		});
	});
});

describe("homeFolderStatusQueryOptions", () => {
	it("keys by folder, stays fresh for 30s, and waits for a folder", () => {
		const options = homeFolderStatusQueryOptions("/p");
		expect(options.queryKey).toStrictEqual(["home", "folder-status", "/p"]);
		expect(options.staleTime).toBe(30_000);
		expect(options.enabled).toBe(true);
		expect(homeFolderStatusQueryOptions(undefined).enabled).toBe(false);
	});
});
