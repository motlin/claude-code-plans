import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {getCacheDir, openAppDb} from "../src/lib/db/connection";
import {getDb} from "../src/lib/db/index";
import {hmrPersist} from "../src/lib/hmr-persist";
import type {AppDb} from "../src/lib/db/connection";
import {isolateGitEnvironment, runGit, scrubGitEnvironment} from "./git-fixture";

const gitVariablesAtLoad = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("GIT_")));

// Builds the sentinel without the helper under test, so a broken helper can never
// create or touch anything but the sentinel's own temporary directory.
function sentinelGit(cwd: string, arguments_: string[]): string {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
	return execFileSync("git", ["-c", "core.fsmonitor=false", ...arguments_], {
		cwd,
		env,
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
}

describe("test suite git isolation", () => {
	let fixtureDirectory: string;
	let sentinelDirectory: string;
	let savedGitEnvironment: [string, string | undefined][];

	beforeEach(() => {
		fixtureDirectory = mkdtempSync(join(tmpdir(), "git-isolation-test-"));
		sentinelDirectory = join(fixtureDirectory, "sentinel");
		sentinelGit(fixtureDirectory, ["init", "--quiet", "--initial-branch=main", sentinelDirectory]);
		sentinelGit(sentinelDirectory, [
			"-c",
			"user.name=Alice",
			"-c",
			"user.email=alice@example.com",
			"commit",
			"--quiet",
			"--allow-empty",
			"--message=Sentinel commit",
		]);
		savedGitEnvironment = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].map((name) => [
			name,
			process.env[name],
		]);
	});

	afterEach(() => {
		for (const [name, value] of savedGitEnvironment) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		rmSync(fixtureDirectory, {recursive: true, force: true});
	});

	it("starts every test file with only the pinned git config in its GIT_* variables", () => {
		expect(gitVariablesAtLoad).toStrictEqual({
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "core.fsmonitor",
			GIT_CONFIG_VALUE_0: "false",
		});
	});

	it("removes every GIT_* variable from an environment", () => {
		const environment: NodeJS.ProcessEnv = {
			GIT_DIR: "/somewhere/.git",
			GIT_INDEX_FILE: "/somewhere/.git/index",
			HOME: "/home/alice",
			PATH: "/usr/bin",
		};

		scrubGitEnvironment(environment);

		expect(environment).toStrictEqual({HOME: "/home/alice", PATH: "/usr/bin"});
	});

	it("replaces every GIT_* variable in an environment with the pinned git config", () => {
		const environment: NodeJS.ProcessEnv = {
			GIT_CONFIG_COUNT: "2",
			GIT_CONFIG_KEY_1: "core.fsmonitor",
			GIT_CONFIG_VALUE_1: "true",
			GIT_DIR: "/somewhere/.git",
			HOME: "/home/alice",
		};

		isolateGitEnvironment(environment);

		expect(environment).toStrictEqual({
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "core.fsmonitor",
			GIT_CONFIG_VALUE_0: "false",
			HOME: "/home/alice",
		});
	});

	it("keeps the git test helper off a repository named by an inherited GIT_DIR", () => {
		const sentinelGitDirectory = join(sentinelDirectory, ".git");
		const configBefore = readFileSync(join(sentinelGitDirectory, "config"), "utf8");
		const refsBefore = sentinelGit(sentinelDirectory, ["for-each-ref"]);
		const otherRepository = join(fixtureDirectory, "other");

		process.env["GIT_DIR"] = sentinelGitDirectory;
		process.env["GIT_WORK_TREE"] = sentinelDirectory;
		process.env["GIT_INDEX_FILE"] = join(sentinelGitDirectory, "index");
		try {
			runGit(fixtureDirectory, ["init", "--quiet", "--initial-branch=main", otherRepository]);
			runGit(otherRepository, ["config", "core.bare", "true"]);
			runGit(otherRepository, ["config", "user.name", "Bob"]);
			runGit(otherRepository, ["update-ref", "refs/heads/intruder", "HEAD"]);
		} catch {
			// A failing helper call is fine; only the sentinel's state matters.
		} finally {
			delete process.env["GIT_DIR"];
			delete process.env["GIT_WORK_TREE"];
			delete process.env["GIT_INDEX_FILE"];
		}

		expect({
			config: readFileSync(join(sentinelGitDirectory, "config"), "utf8"),
			refs: sentinelGit(sentinelDirectory, ["for-each-ref"]),
		}).toStrictEqual({config: configBefore, refs: refsBefore});
		expect(sentinelGit(sentinelDirectory, ["config", "--get", "core.bare"])).toBe("false");
	});
});

describe("test suite database isolation", () => {
	const dbHolder = hmrPersist<{db: AppDb | null}>("appDbHolder", () => ({db: null}));
	let savedDb: AppDb | null;
	let savedCacheHome: string | undefined;
	let cacheHome: string;

	beforeEach(() => {
		savedDb = dbHolder.db;
		dbHolder.db = null;
		savedCacheHome = process.env["XDG_CACHE_HOME"];
		cacheHome = mkdtempSync(join(tmpdir(), "db-isolation-test-"));
		process.env["XDG_CACHE_HOME"] = cacheHome;
	});

	afterEach(() => {
		dbHolder.db = savedDb;
		if (savedCacheHome === undefined) delete process.env["XDG_CACHE_HOME"];
		else process.env["XDG_CACHE_HOME"] = savedCacheHome;
		rmSync(cacheHome, {recursive: true, force: true});
	});

	it("throws when getDb() is called without an injected test database", () => {
		expect(() => getDb()).toThrow(/must pass an explicit cacheDir/);
	});

	it("refuses to open the user cache directory even when it is passed explicitly", () => {
		expect(() => openAppDb({cacheDir: getCacheDir()})).toThrow(/user cache directory/);
	});
});

describe("test suite git fsmonitor isolation", () => {
	let fixtureDirectory: string;
	let repository: string;
	let savedEnvironment: [string, string | undefined][];

	// Asks git directly, with only the developer-style HOME config, whether a daemon watches `cwd`.
	function fsmonitorDaemonIsWatching(cwd: string): boolean {
		const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
		return spawnSync("git", ["fsmonitor--daemon", "status"], {cwd, env, stdio: "ignore"}).status === 0;
	}

	beforeEach(() => {
		fixtureDirectory = mkdtempSync(join(tmpdir(), "git-fsmonitor-test-"));
		repository = join(fixtureDirectory, "repository");
		const home = join(fixtureDirectory, "home");
		mkdirSync(home);
		// Mirrors a developer whose global git config turns on the builtin fsmonitor.
		writeFileSync(join(home, ".gitconfig"), "[core]\n\tfsmonitor = true\n");
		savedEnvironment = ["HOME", "XDG_CONFIG_HOME"].map((name) => [name, process.env[name]]);
		process.env["HOME"] = home;
		process.env["XDG_CONFIG_HOME"] = join(home, ".config");
	});

	afterEach(() => {
		// Stops only the daemon this fixture could have started, never anyone else's.
		const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
		spawnSync("git", ["fsmonitor--daemon", "stop"], {cwd: repository, env, stdio: "ignore"});
		for (const [name, value] of savedEnvironment) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		rmSync(fixtureDirectory, {recursive: true, force: true});
	});

	it("leaves no fsmonitor daemon watching a fixture repository after git commands", () => {
		runGit(fixtureDirectory, ["init", "--quiet", "--initial-branch=main", repository]);
		writeFileSync(join(repository, "file.txt"), "content\n");
		runGit(repository, ["status", "--porcelain"]);
		// Code under test spawns git with the inherited process environment.
		execFileSync("git", ["status", "--porcelain"], {cwd: repository, stdio: "ignore"});

		expect(fsmonitorDaemonIsWatching(repository)).toBe(false);
	});
});
