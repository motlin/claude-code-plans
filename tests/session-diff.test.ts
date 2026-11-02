import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import
{
	buildScopeDiff,
	type DiffFile,
	listScopes,
	parseDiffFiles,
	readDiffFileSides,
	resolveDiffBase,
	type RunGit,
} from "../src/lib/session-diff";
import {patchFingerprint} from "../src/lib/diff-file-marks";
import {runGit} from "./git-fixture";

type FileSummary = Omit<DiffFile, "patch">;

function summarize(files: DiffFile[]): FileSummary[]
{
	return files.map(({patch: _patch, ...rest}) => rest);
}

describe("session diff service over a real repository", () =>
{
	let repositoryDirectory: string;
	let commitCounter = 0;

	function git(...arguments_: string[]): string
	{
		commitCounter += 1;
		const date = `2026-01-01T00:00:${String(commitCounter % 60).padStart(2, "0")}Z`;
		return runGit(
			repositoryDirectory,
			arguments_,
			{
				env:
				{
					GIT_AUTHOR_DATE: date,
					GIT_COMMITTER_DATE: date,
				},
			},
		);
	}

	function write(path: string, content: string): void
	{
		writeFileSync(join(repositoryDirectory, path), content);
	}

	beforeEach(() =>
	{
		repositoryDirectory = mkdtempSync(join(tmpdir(), "session-diff-test-"));
		commitCounter = 0;

		git("init", "--initial-branch=main");
		git("config", "user.email", "alice@example.com");
		git("config", "user.name", "Alice");
		write("keep.txt", "one\ntwo\nthree\n");
		write("old-name.txt", "alpha\nbeta\ngamma\ndelta\nepsilon\n");
		write("doomed.txt", "bye\nbye\n");
		write("dirty.txt", "clean\n");
		git("add", ".");
		git("commit", "--message", "Initial commit.");
	});

	afterEach(() =>
	{
		rmSync(
			repositoryDirectory,
			{
				recursive: true,
				force: true,
			},
		);
	});

	function buildFeatureBranch(): void
	{
		git("switch", "--create", "feature");
		git("mv", "old-name.txt", "new-name.txt");
		write("feature.txt", "new\nfeature\n");
		git("add", ".");
		git("commit", "--message", "Rename and add feature.");
		git("rm", "--quiet", "doomed.txt");
		write("keep.txt", "one\nTWO\nthree\nfour\n");
		git("add", ".");
		git("commit", "--message", "Delete doomed and edit keep.");

		git("switch", "main");
		write("main-only.txt", "not on the branch\n");
		git("add", ".");
		git("commit", "--message", "Advance main.");
		git("switch", "feature");

		write("dirty.txt", "dirty\n");
		write("untracked.txt", "fresh\n");
	}

	it("resolves the base as the merge-base with main", async () =>
	{
		buildFeatureBranch();
		const mergeBase = git("merge-base", "main", "HEAD");

		expect(await resolveDiffBase(repositoryDirectory)).toStrictEqual(
			{
				kind: "ok",
				base: "main",
				baseRef: "main",
				mergeBase,
			},
		);
	});

	it("prefers origin/HEAD over main", async () =>
	{
		git("commit", "--allow-empty", "--message", "Second.");
		const remoteSha = git("rev-parse", "HEAD~1");
		git("update-ref", "refs/remotes/origin/trunk", remoteSha);
		git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");

		expect(await resolveDiffBase(repositoryDirectory)).toStrictEqual(
			{
				kind: "ok",
				base: "trunk",
				baseRef: "origin/trunk",
				mergeBase: remoteSha,
			},
		);
	});

	it("falls back to master when there is no origin/HEAD or main", async () =>
	{
		git("branch", "--move", "main", "master");
		const head = git("rev-parse", "HEAD");

		expect(await resolveDiffBase(repositoryDirectory)).toStrictEqual(
			{
				kind: "ok",
				base: "master",
				baseRef: "master",
				mergeBase: head,
			},
		);
	});

	it("lists the branch scope with every change since the merge-base", async () =>
	{
		buildFeatureBranch();

		const result = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "branch",
			},
		);
		if (result.kind !== "ok") throw new Error(`unexpected ${result.kind}`);

		expect(summarize(result.files)).toStrictEqual([
			{
				path: "dirty.txt",
				status: "modified",
				additions: 1,
				deletions: 1,
				binary: false,
			},
			{
				path: "doomed.txt",
				status: "deleted",
				additions: 0,
				deletions: 2,
				binary: false,
			},
			{
				path: "feature.txt",
				status: "added",
				additions: 2,
				deletions: 0,
				binary: false,
			},
			{
				path: "keep.txt",
				status: "modified",
				additions: 2,
				deletions: 1,
				binary: false,
			},
			{
				path: "new-name.txt",
				oldPath: "old-name.txt",
				status: "renamed",
				additions: 0,
				deletions: 0,
				binary: false,
			},
			{
				path: "untracked.txt",
				status: "added",
				additions: 1,
				deletions: 0,
				binary: false,
			},
		]);
	});

	it("lists only working-tree changes in the uncommitted scope", async () =>
	{
		buildFeatureBranch();

		const result = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "uncommitted",
			},
		);
		if (result.kind !== "ok") throw new Error(`unexpected ${result.kind}`);

		expect(summarize(result.files)).toStrictEqual([
			{
				path: "dirty.txt",
				status: "modified",
				additions: 1,
				deletions: 1,
				binary: false,
			},
			{
				path: "untracked.txt",
				status: "added",
				additions: 1,
				deletions: 0,
				binary: false,
			},
		]);
	});

	it("empties the uncommitted scope after committing everything", async () =>
	{
		buildFeatureBranch();
		git("add", ".");
		git("commit", "--message", "Commit the rest.");

		const result = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "uncommitted",
			},
		);

		expect(result).toStrictEqual(
			{
				kind: "ok",
				patch: "",
				files: [],
			},
		);
		const scopes = await listScopes(repositoryDirectory);
		if (scopes.kind !== "ok") throw new Error(`unexpected ${scopes.kind}`);
		expect(scopes.uncommittedAvailable).toBe(false);
	});

	it("lists one commit's changes in the commit scope", async () =>
	{
		buildFeatureBranch();
		const sha = git("rev-parse", "HEAD~1");

		const result = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "commit",
				sha,
			},
		);
		if (result.kind !== "ok") throw new Error(`unexpected ${result.kind}`);

		expect(summarize(result.files)).toStrictEqual([
			{
				path: "feature.txt",
				status: "added",
				additions: 2,
				deletions: 0,
				binary: false,
			},
			{
				path: "new-name.txt",
				oldPath: "old-name.txt",
				status: "renamed",
				additions: 0,
				deletions: 0,
				binary: false,
			},
		]);
	});

	it("writes full index ids, so a hunkless patch fingerprints by them (changes-file-viewed-marks T10)", async () =>
	{
		write("empty.txt", "");
		git("add", "empty.txt");
		write("logo.png", "\u0000\u0001\u0002");
		git("add", "logo.png");
		write("keep.txt", "one\nTWO\nthree\n");

		const result = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "uncommitted",
			},
		);
		if (result.kind !== "ok") throw new Error(`unexpected ${result.kind}`);
		const empty = result.files.find((file) => file.path === "empty.txt")?.patch;
		const keep = result.files.find((file) => file.path === "keep.txt")?.patch;
		const logo = result.files.find((file) => file.path === "logo.png");
		const blob = git("hash-object", "empty.txt");
		const logoBlob = git("hash-object", "logo.png");

		// A binary file has no hunks, so upstream marks it by its full index ids too.
		expect(
			{
				emptyFingerprint: patchFingerprint(empty),
				keepIndex: /^index [0-9a-f]{40}\.\.[0-9a-f]{40} 100644$/m.test(keep ?? ""),
				logo:
				{
					binary: logo?.binary,
					fingerprint: patchFingerprint(logo?.patch),
				},
			},
		).toStrictEqual(
			{
				emptyFingerprint: `ids:${"0".repeat(40)}..${blob}\nnew file 100`,
				keepIndex: true,
				logo:
				{
					binary: true,
					fingerprint: `ids:${"0".repeat(40)}..${logoBlob}\nnew file 100`,
				},
			},
		);
	});

	it("ignores whitespace-only changes when hideWhitespace is set", async () =>
	{
		write("keep.txt", "one\n  two\nthree\n");

		const shown = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "uncommitted",
			},
		);
		const hidden = await buildScopeDiff(
			repositoryDirectory,
			{
				kind: "uncommitted",
			},
			{
				hideWhitespace: true,
			},
		);
		if (shown.kind !== "ok") throw new Error(`unexpected ${shown.kind}`);

		expect(summarize(shown.files)).toStrictEqual([
			{
				path: "keep.txt",
				status: "modified",
				additions: 1,
				deletions: 1,
				binary: false,
			},
		]);
		expect(hidden).toStrictEqual(
			{
				kind: "ok",
				patch: "",
				files: [],
			},
		);
	});

	it("lists scopes with head, dirtiness, and newest-first commits", async () =>
	{
		buildFeatureBranch();
		const newest = git("rev-parse", "HEAD");
		const older = git("rev-parse", "HEAD~1");
		const mergeBase = git("merge-base", "main", "HEAD");

		const scopes = await listScopes(repositoryDirectory);

		expect(scopes).toStrictEqual(
			{
				kind: "ok",
				base: "main",
				baseRef: "main",
				mergeBase,
				head: "feature",
				uncommittedAvailable: true,
				commits: [
					{
						sha: newest,
						shortSha: git("rev-parse", "--short", newest),
						subject: "Delete doomed and edit keep.",
						author: "Alice",
						date: git("log", "-1", "--format=%aI", newest),
					},
					{
						sha: older,
						shortSha: git("rev-parse", "--short", older),
						subject: "Rename and add feature.",
						author: "Alice",
						date: git("log", "-1", "--format=%aI", older),
					},
				],
				totalCommits: 2,
			},
		);
	});

	it("reports a detached head as null", async () =>
	{
		git("switch", "--detach", "HEAD");

		const scopes = await listScopes(repositoryDirectory);
		if (scopes.kind !== "ok") throw new Error(`unexpected ${scopes.kind}`);

		expect(scopes.head).toBeNull();
	});

	it("caps the commit list at 50 while reporting the total", async () =>
	{
		const stream = Array.from(
			{
				length: 55,
			},
			(_, offset) =>
			{
				const message = `Commit ${offset + 1}.`;
				return [
					"commit refs/heads/many",
					`committer Alice <alice@example.com> ${1_767_225_600 + offset} +0000`,
					`data ${message.length}`,
					message,
					offset === 0 ? "from refs/heads/main" : "",
					"",
				].join("\n");
			},
		).join("");
		runGit(
			repositoryDirectory,
			["fast-import", "--quiet"],
			{
				input: stream,
			},
		);
		git("switch", "many");

		const scopes = await listScopes(repositoryDirectory);
		if (scopes.kind !== "ok") throw new Error(`unexpected ${scopes.kind}`);

		expect(scopes.totalCommits).toBe(55);
		expect(scopes.commits.map((commit) => commit.subject)).toStrictEqual(
			Array.from(
				{
					length: 50,
				},
				(_, index) => `Commit ${55 - index}.`,
			),
		);
	});
});

describe("session diff service outside a repository", () =>
{
	let directory: string;

	beforeEach(() =>
	{
		directory = mkdtempSync(join(tmpdir(), "session-diff-no-git-"));
	});

	afterEach(() =>
	{
		rmSync(
			directory,
			{
				recursive: true,
				force: true,
			},
		);
	});

	it("reports no-git for every entry point", async () =>
	{
		expect(await resolveDiffBase(directory)).toStrictEqual(
			{
				kind: "no-git",
			},
		);
		expect(await listScopes(directory)).toStrictEqual(
			{
				kind: "no-git",
			},
		);
		expect(
			await buildScopeDiff(
				directory,
				{
					kind: "branch",
				},
			),
		).toStrictEqual(
			{
				kind: "no-git",
			},
		);
	});
});

describe("resolveDiffBase with an injected runGit", () =>
{
	it("tries origin/HEAD, then main, then master, using argv arrays", async () =>
	{
		const calls: string[][] = [];
		const runGit: RunGit = async (_cwd, arguments_) =>
		{
			calls.push(arguments_);
			const key = arguments_.join(" ");
			if (key === "rev-parse --is-inside-work-tree") return Promise.resolve("true\n");
			if (key === "rev-parse --verify --quiet master^{commit}") return Promise.resolve("abc\n");
			if (key === "merge-base master HEAD") return Promise.resolve("abc\n");
			return Promise.reject(new Error(`fatal: ${key}`));
		};

		expect(await resolveDiffBase("/repo", runGit)).toStrictEqual(
			{
				kind: "ok",
				base: "master",
				baseRef: "master",
				mergeBase: "abc",
			},
		);
		expect(calls).toStrictEqual([
			["rev-parse", "--is-inside-work-tree"],
			["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
			["rev-parse", "--verify", "--quiet", "main^{commit}"],
			["rev-parse", "--verify", "--quiet", "master^{commit}"],
			["merge-base", "master", "HEAD"],
		]);
	});
});

describe("readDiffFileSides (upstream desktop getDiffFileContent)", () =>
{
	/** A fake git that answers the base lookup and `show <rev>:<path>` from `blobs`, recording each `show`. */
	function fakeGit(blobs: Record<string, string>)
	{
		const calls: string[][] = [];
		const runGit: RunGit = async (_cwd, arguments_) =>
		{
			const key = arguments_.join(" ");
			if (key === "symbolic-ref --quiet --short refs/remotes/origin/HEAD")
				return Promise.resolve("origin/main\n");
			if (key === "merge-base origin/main HEAD") return Promise.resolve("base123\n");
			calls.push(arguments_);
			const blob = arguments_[0] === "show" ? blobs[arguments_[1] ?? ""] : undefined;
			return blob === undefined ? Promise.reject(new Error(`fatal: ${key}`)) : Promise.resolve(blob);
		};
		return {
			calls,
			runGit,
		};
	}

	function fakeWorkingTree(files: Record<string, string>)
	{
		const reads: string[] = [];
		const readWorkingFile = async (root: string, path: string) =>
		{
			reads.push(`${root}:${path}`);
			return Promise.resolve(files[path] ?? null);
		};
		return {
			reads,
			readWorkingFile,
		};
	}

	async function sides(
		scope: Parameters<typeof readDiffFileSides>[1],
		file: Parameters<typeof readDiffFileSides>[2],
		blobs: Record<string, string>,
		working: Record<string, string>,
	)
	{
		const git = fakeGit(blobs);
		const tree = fakeWorkingTree(working);
		const result = await readDiffFileSides("/repo", scope, file, git.runGit, tree.readWorkingFile);
		return {
			result,
			calls: git.calls,
			reads: tree.reads,
		};
	}

	it("reads the merge-base side and the working tree for the branch scope", async () =>
	{
		expect(
			await sides(
				{
					kind: "branch",
				},
				{
					path: "src/a.ts",
					status: "modified",
				},
				{
					"base123:src/a.ts": "old\n",
				},
				{
					"src/a.ts": "new\n",
				},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: "old\n",
					newText: "new\n",
				},
				calls: [["show", "base123:src/a.ts"]],
				reads: ["/repo:src/a.ts"],
			},
		);
	});

	it("reads HEAD and the working tree for uncommitted changes", async () =>
	{
		expect(
			await sides(
				{
					kind: "uncommitted",
				},
				{
					path: "src/a.ts",
					status: "modified",
				},
				{
					"HEAD:src/a.ts": "old\n",
				},
				{
					"src/a.ts": "new\n",
				},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: "old\n",
					newText: "new\n",
				},
				calls: [["show", "HEAD:src/a.ts"]],
				reads: ["/repo:src/a.ts"],
			},
		);
	});

	it("reads the commit's parent and the commit for a commit scope, never the working tree", async () =>
	{
		expect(
			await sides(
				{
					kind: "commit",
					sha: "abc123",
				},
				{
					path: "src/a.ts",
					status: "modified",
				},
				{
					"abc123^:src/a.ts": "old\n",
					"abc123:src/a.ts": "new\n",
				},
				{
					"src/a.ts": "working\n",
				},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: "old\n",
					newText: "new\n",
				},
				calls: [
					["show", "abc123^:src/a.ts"],
					["show", "abc123:src/a.ts"],
				],
				reads: [],
			},
		);
	});

	it("reads a renamed file's old side from its old path", async () =>
	{
		expect(
			await sides(
				{
					kind: "branch",
				},
				{
					path: "src/new.ts",
					oldPath: "src/old.ts",
					status: "renamed",
				},
				{
					"base123:src/old.ts": "old\n",
				},
				{
					"src/new.ts": "new\n",
				},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: "old\n",
					newText: "new\n",
				},
				calls: [["show", "base123:src/old.ts"]],
				reads: ["/repo:src/new.ts"],
			},
		);
	});

	it("skips the old side of an added file and the new side of a deleted one", async () =>
	{
		expect(
			await sides(
				{
					kind: "branch",
				},
				{
					path: "src/a.ts",
					status: "added",
				},
				{},
				{
					"src/a.ts": "new\n",
				},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: null,
					newText: "new\n",
				},
				calls: [],
				reads: ["/repo:src/a.ts"],
			},
		);
		expect(
			await sides(
				{
					kind: "branch",
				},
				{
					path: "src/a.ts",
					status: "deleted",
				},
				{
					"base123:src/a.ts": "old\n",
				},
				{},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: "old\n",
					newText: null,
				},
				calls: [["show", "base123:src/a.ts"]],
				reads: [],
			},
		);
	});

	it("gives a side git can't show, or one past the 2 MB cap, as null", async () =>
	{
		expect(
			await sides(
				{
					kind: "commit",
					sha: "abc123",
				},
				{
					path: "src/a.ts",
					status: "modified",
				},
				{
					"abc123:src/a.ts": "x".repeat(2 * 1024 * 1024 + 1),
				},
				{},
			),
		).toStrictEqual(
			{
				result:
				{
					oldText: null,
					newText: null,
				},
				calls: [
					["show", "abc123^:src/a.ts"],
					["show", "abc123:src/a.ts"],
				],
				reads: [],
			},
		);
	});

	it("rejects a path or old path outside the checkout before reading anything", async () =>
	{
		for (const file of [
			{
				path: "../x",
				status: "modified" as const,
			},
			{
				path: "/etc/hosts",
				status: "modified" as const,
			},
			{
				path: "src/../../x",
				status: "modified" as const,
			},
			{
				path: "src/a.ts",
				oldPath: "../old.ts",
				status: "renamed" as const,
			},
		])
		{
			expect(
				await sides(
					{
						kind: "uncommitted",
					},
					file,
					{},
					{},
				),
			).toStrictEqual(
				{
					result: null,
					calls: [],
					reads: [],
				},
			);
		}
	});
});

describe("readDiffFileSides over a real repository", () =>
{
	let repositoryDirectory: string;

	beforeEach(() =>
	{
		repositoryDirectory = mkdtempSync(join(tmpdir(), "session-diff-sides-"));
		runGit(repositoryDirectory, ["init", "--initial-branch=main"]);
		runGit(repositoryDirectory, ["config", "user.email", "alice@example.com"]);
		runGit(repositoryDirectory, ["config", "user.name", "Alice"]);
		writeFileSync(join(repositoryDirectory, "a.txt"), "one\ntwo\n");
		runGit(repositoryDirectory, ["add", "."]);
		runGit(repositoryDirectory, ["commit", "--message", "Initial commit."]);
	});

	afterEach(() =>
	{
		rmSync(
			repositoryDirectory,
			{
				recursive: true,
				force: true,
			},
		);
	});

	it("reads HEAD through git and the edited working file from disk", async () =>
	{
		writeFileSync(join(repositoryDirectory, "a.txt"), "one\nTWO\n");
		expect(
			await readDiffFileSides(
				repositoryDirectory,
				{
					kind: "uncommitted",
				},
				{
					path: "a.txt",
					status: "modified",
				},
			),
		).toStrictEqual(
			{
				oldText: "one\ntwo\n",
				newText: "one\nTWO\n",
			},
		);
	});

	it("gives a working file that's missing as null", async () =>
	{
		rmSync(join(repositoryDirectory, "a.txt"));
		expect(
			await readDiffFileSides(
				repositoryDirectory,
				{
					kind: "uncommitted",
				},
				{
					path: "a.txt",
					status: "modified",
				},
			),
		).toStrictEqual(
			{
				oldText: "one\ntwo\n",
				newText: null,
			},
		);
	});

	it("won't follow a working-tree symlink out of the checkout", async () =>
	{
		const outside = mkdtempSync(join(tmpdir(), "session-diff-outside-"));
		try
		{
			writeFileSync(join(outside, "secret.txt"), "fake-secret\n");
			symlinkSync(join(outside, "secret.txt"), join(repositoryDirectory, "link.txt"));
			expect(
				await readDiffFileSides(
					repositoryDirectory,
					{
						kind: "uncommitted",
					},
					{
						path: "link.txt",
						status: "added",
					},
				),
			).toStrictEqual(
				{
					oldText: null,
					newText: null,
				},
			);
		}
		finally
		{
			rmSync(
				outside,
				{
					recursive: true,
					force: true,
				},
			);
		}
	});
});

describe("parseDiffFiles", () =>
{
	it("returns an empty list for an empty patch", () =>
	{
		expect(parseDiffFiles("")).toStrictEqual([]);
	});

	it("parses modified, added, deleted, renamed, binary, and quoted files", () =>
	{
		const modified = [
			"diff --git a/src/app.ts b/src/app.ts",
			"index 1111111..2222222 100644",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"@@ -1,2 +1,2 @@",
			"-const a = 1;",
			"+const a = 2;",
			" const b = 3;",
			"\\ No newline at end of file",
			"",
		].join("\n");
		const added = [
			"diff --git a/with space.md b/with space.md",
			"new file mode 100644",
			"index 0000000..3333333",
			"--- /dev/null",
			"+++ b/with space.md",
			"@@ -0,0 +1,2 @@",
			"+--- not a header",
			"+second",
			"",
		].join("\n");
		const deleted = [
			"diff --git a/gone.txt b/gone.txt",
			"deleted file mode 100644",
			"index 4444444..0000000",
			"--- a/gone.txt",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-bye",
			"",
		].join("\n");
		const renamed = [
			"diff --git a/old dir/x.ts b/new dir/x.ts",
			"similarity index 90%",
			"rename from old dir/x.ts",
			"rename to new dir/x.ts",
			"index 5555555..6666666 100644",
			"--- a/old dir/x.ts",
			"+++ b/new dir/x.ts",
			"@@ -1 +1 @@",
			"-a",
			"+b",
			"",
		].join("\n");
		const binary = [
			"diff --git a/logo.png b/logo.png",
			"new file mode 100644",
			"index 0000000..7777777",
			"Binary files /dev/null and b/logo.png differ",
			"",
		].join("\n");
		const quoted = [
			'diff --git "a/caf\\303\\251\\n.txt" "b/caf\\303\\251\\n.txt"',
			"new file mode 100644",
			"index 0000000..8888888",
			"--- /dev/null",
			'+++ "b/caf\\303\\251\\n.txt"',
			"@@ -0,0 +1 @@",
			"+x",
			"",
		].join("\n");
		const emptyDeleted = [
			"diff --git a/empty.txt b/empty.txt",
			"deleted file mode 100644",
			"index e69de29..0000000",
			"",
		].join("\n");

		expect(parseDiffFiles(modified + added + deleted + renamed + binary + quoted + emptyDeleted)).toStrictEqual([
			{
				path: "src/app.ts",
				status: "modified",
				additions: 1,
				deletions: 1,
				binary: false,
				patch: modified,
			},
			{
				path: "with space.md",
				status: "added",
				additions: 2,
				deletions: 0,
				binary: false,
				patch: added,
			},
			{
				path: "gone.txt",
				status: "deleted",
				additions: 0,
				deletions: 1,
				binary: false,
				patch: deleted,
			},
			{
				path: "new dir/x.ts",
				oldPath: "old dir/x.ts",
				status: "renamed",
				additions: 1,
				deletions: 1,
				binary: false,
				patch: renamed,
			},
			{
				path: "logo.png",
				status: "added",
				additions: 0,
				deletions: 0,
				binary: true,
				patch: binary,
			},
			{
				path: "café\n.txt",
				status: "added",
				additions: 1,
				deletions: 0,
				binary: false,
				patch: quoted,
			},
			{
				path: "empty.txt",
				status: "deleted",
				additions: 0,
				deletions: 0,
				binary: false,
				patch: emptyDeleted,
			},
		]);
	});
});
