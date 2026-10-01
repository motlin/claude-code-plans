import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {SessionFilesResponseSchema, sessionFilesQueryOptions} from "../src/lib/api/session-files";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {fuzzyFilePaths, gitCheckIgnored, listDir, walkWorkspace, WorkspacePathError} from "../src/lib/workspace-files";
import {handleSessionFilesRequest, type SessionFilesHandlerDependencies} from "../src/lib/workspace-files-handler";
import {runGit} from "./git-fixture";

const SESSION_ID = "session-files-100";

let db: AppDb;
let base: string;
let root: string;
let outside: string;

function write(path: string, content = ""): void {
	writeFileSync(join(root, path), content);
}

function insertSession(cwd: string | null): void {
	db.index
		.insert(schema.projects)
		.values({id: "project-files-100", name: "example", projectPath: "/example", updatedAt: 0})
		.run();
	db.index
		.insert(schema.sessions)
		.values({
			id: SESSION_ID,
			projectId: "project-files-100",
			title: "Files example",
			firstPrompt: null,
			summary: null,
			customTitle: null,
			messageCount: 1,
			gitBranch: null,
			cwd,
			isSidechain: 0,
			createdAt: 946_598_400_000,
			mtimeMs: 946_684_800_000,
			filePath: `/transcripts/${SESSION_ID}.jsonl`,
		})
		.run();
}

function dependencies(allowedRoots: string[] = [root]): SessionFilesHandlerDependencies {
	return {
		index: db.index,
		allowedRoots: async () => allowedRoots,
		checkIgnored: gitCheckIgnored,
	};
}

async function request(
	parameters: Record<string, string>,
	allowedRoots?: string[],
): Promise<{status: number; body: unknown}> {
	const response = await handleSessionFilesRequest(
		SESSION_ID,
		new URLSearchParams(parameters),
		dependencies(allowedRoots),
	);
	return {status: response.status, body: await response.json()};
}

beforeEach(() => {
	db = openTestDb();
	base = realpathSync(mkdtempSync(join(tmpdir(), "session-files-")));
	root = join(base, "workspace");
	outside = join(base, "outside");
	mkdirSync(root);
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.txt"), "secret");

	write(".envrc");
	write("README.md");
	write("alpha.ts");
	write("Beta.ts");
	mkdirSync(join(root, "docs"));
	mkdirSync(join(root, "src", "nested"), {recursive: true});
	write("src/index.ts");
	write("src/nested/deep-file.ts");
	symlinkSync("src/index.ts", join(root, "link-inside"));
	symlinkSync("src", join(root, "link-dir"));
	symlinkSync(join(outside, "secret.txt"), join(root, "link-outside"));
	symlinkSync(outside, join(root, "link-outside-dir"));
	symlinkSync("missing.txt", join(root, "link-broken"));
});

afterEach(() => {
	db.close();
	rmSync(base, {recursive: true, force: true});
});

const ROOT_ENTRIES = [
	{name: "docs", relPath: "docs", isDirectory: true},
	{
		name: "link-dir",
		relPath: "link-dir",
		isDirectory: true,
		symlink: {target: "src", outside: false, broken: false},
	},
	{
		name: "link-outside-dir",
		relPath: "link-outside-dir",
		isDirectory: true,
		symlink: {target: "<outside>", outside: true, broken: false},
	},
	{name: "src", relPath: "src", isDirectory: true},
	{name: ".envrc", relPath: ".envrc", isDirectory: false},
	{name: "alpha.ts", relPath: "alpha.ts", isDirectory: false},
	{name: "Beta.ts", relPath: "Beta.ts", isDirectory: false},
	{
		name: "link-broken",
		relPath: "link-broken",
		isDirectory: false,
		symlink: {target: "missing.txt", outside: false, broken: true},
	},
	{
		name: "link-inside",
		relPath: "link-inside",
		isDirectory: false,
		symlink: {target: "src/index.ts", outside: false, broken: false},
	},
	{
		name: "link-outside",
		relPath: "link-outside",
		isDirectory: false,
		symlink: {target: "<outside>/secret.txt", outside: true, broken: false},
	},
	{name: "README.md", relPath: "README.md", isDirectory: false},
];

function rootEntries(): unknown[] {
	return ROOT_ENTRIES.map((entry) =>
		"symlink" in entry
			? {
					...entry,
					symlink: {...entry.symlink, target: entry.symlink.target.replace("<outside>", outside)},
				}
			: entry,
	);
}

describe("listDir", () => {
	it("lists hidden entries and symlinks, dirs first, case-insensitively sorted", async () => {
		expect(await listDir(root, "")).toStrictEqual({entries: rootEntries(), partial: false});
	});

	it("lists a nested directory with root-relative paths", async () => {
		expect(await listDir(root, "src")).toStrictEqual({
			entries: [
				{name: "nested", relPath: "src/nested", isDirectory: true},
				{name: "index.ts", relPath: "src/index.ts", isDirectory: false},
			],
			partial: false,
		});
	});

	it("marks the listing partial when it exceeds the cap", async () => {
		expect(await listDir(root, "", {cap: 3})).toStrictEqual({
			entries: rootEntries().slice(0, 3),
			partial: true,
		});
	});

	it("refuses traversal, absolute paths, and symlinks that leave the root", async () => {
		await expect(listDir(root, "../..")).rejects.toStrictEqual(
			new WorkspacePathError("A relative path inside the working directory is required", 403),
		);
		await expect(listDir(root, outside)).rejects.toStrictEqual(
			new WorkspacePathError("A relative path inside the working directory is required", 403),
		);
		await expect(listDir(root, "link-outside-dir")).rejects.toStrictEqual(
			new WorkspacePathError("Directory is outside the working directory", 403),
		);
		await expect(listDir(root, "missing")).rejects.toStrictEqual(
			new WorkspacePathError("Directory not found", 404),
		);
		await expect(listDir(root, "alpha.ts")).rejects.toStrictEqual(
			new WorkspacePathError("Directory not found", 404),
		);
	});
});

describe("walkWorkspace", () => {
	it("walks breadth-first without following symlinks", async () => {
		expect(await walkWorkspace(root, "")).toStrictEqual({
			entries: [
				...rootEntries(),
				{name: "nested", relPath: "src/nested", isDirectory: true},
				{name: "index.ts", relPath: "src/index.ts", isDirectory: false},
				{name: "deep-file.ts", relPath: "src/nested/deep-file.ts", isDirectory: false},
			],
			partial: false,
		});
	});

	it("stops at the cap and marks the walk partial", async () => {
		expect(await walkWorkspace(root, "", {cap: 2})).toStrictEqual({
			entries: rootEntries().slice(0, 2),
			partial: true,
		});
	});
});

describe("fuzzyFilePaths", () => {
	it("ranks subsequence matches and caps the result", () => {
		expect(fuzzyFilePaths("tst", ["tslib.js", "test/", "src/a.ts", "test-games.js"], 1)).toStrictEqual({
			paths: ["test-games.js"],
			partial: true,
		});
	});

	it("keeps every match under the cap", () => {
		expect(fuzzyFilePaths("idx", ["src/index.ts", "README.md"])).toStrictEqual({
			paths: ["src/index.ts"],
			partial: false,
		});
	});
});

describe("GET /api/sessions/$id/files", () => {
	it("lists the working directory root", async () => {
		insertSession(root);
		expect(await request({})).toStrictEqual({
			status: 200,
			body: {kind: "listing", dir: "", entries: rootEntries(), partial: false},
		});
	});

	it("lists a subdirectory named in the query string", async () => {
		insertSession(root);
		expect(await request({dir: "src/nested"})).toStrictEqual({
			status: 200,
			body: {
				kind: "listing",
				dir: "src/nested",
				entries: [{name: "deep-file.ts", relPath: "src/nested/deep-file.ts", isDirectory: false}],
				partial: false,
			},
		});
	});

	it("fuzzy-searches the whole workspace", async () => {
		insertSession(root);
		expect(await request({q: "deepf"})).toStrictEqual({
			status: 200,
			body: {
				kind: "search",
				dir: "",
				query: "deepf",
				results: [{name: "deep-file.ts", relPath: "src/nested/deep-file.ts", isDirectory: false}],
				partial: false,
				capped: false,
			},
		});
	});

	it("refuses traversal with 403", async () => {
		insertSession(root);
		expect(await request({dir: "../.."})).toStrictEqual({
			status: 403,
			body: {error: "A relative path inside the working directory is required"},
		});
	});

	it("reports a session without a working directory", async () => {
		insertSession(null);
		expect(await request({})).toStrictEqual({status: 200, body: {kind: "no-cwd"}});
	});

	it("reports a working directory that no longer exists", async () => {
		insertSession(join(base, "gone"));
		expect(await request({})).toStrictEqual({status: 200, body: {kind: "no-cwd"}});
	});

	it("refuses a working directory outside the allowed roots", async () => {
		insertSession(root);
		expect(await request({}, [outside])).toStrictEqual({
			status: 403,
			body: {error: "Working directory is not allowed"},
		});
	});

	it("returns 404 for an unknown session", async () => {
		const response = await handleSessionFilesRequest("missing", new URLSearchParams(), dependencies());
		expect({status: response.status, body: await response.json()}).toStrictEqual({
			status: 404,
			body: {error: "Session not found"},
		});
	});

	it("hides gitignored entries only when asked", async () => {
		runGit(root, ["init", "--quiet"]);
		runGit(root, ["config", "core.excludesFile", "/dev/null"]);
		write(".gitignore", "docs/\nalpha.ts\n");
		write("docs/guide.md");
		insertSession(root);

		const hidden = await request({hideIgnored: "1"});
		expect(hidden.status).toBe(200);
		const names = (hidden.body as {entries: {name: string}[]}).entries.map((e) => e.name);
		expect(names).toStrictEqual([
			".git",
			"link-dir",
			"link-outside-dir",
			"src",
			".envrc",
			".gitignore",
			"Beta.ts",
			"link-broken",
			"link-inside",
			"link-outside",
			"README.md",
		]);

		const search = await request({q: "guide", hideIgnored: "1"});
		expect(search.body).toStrictEqual({
			kind: "search",
			dir: "",
			query: "guide",
			results: [],
			partial: false,
			capped: false,
		});

		const shown = await request({q: "guide"});
		expect(shown.body).toStrictEqual({
			kind: "search",
			dir: "",
			query: "guide",
			results: [{name: "guide.md", relPath: "docs/guide.md", isDirectory: false}],
			partial: false,
			capped: false,
		});
	});

	it("marks gitignored entries when asked", async () => {
		runGit(root, ["init", "--quiet"]);
		runGit(root, ["config", "core.excludesFile", "/dev/null"]);
		write(".gitignore", "docs/\nalpha.ts\n");
		write("docs/guide.md");
		insertSession(root);

		const listing = await request({markIgnored: "1"});
		const ignored = (listing.body as {entries: {name: string; ignored?: boolean}[]}).entries
			.filter((entry) => entry.ignored === true)
			.map((entry) => entry.name);
		const search = await request({q: "guide", markIgnored: "1"});

		expect({ignored, search: search.body}).toStrictEqual({
			ignored: ["docs", "alpha.ts"],
			search: {
				kind: "search",
				dir: "",
				query: "guide",
				results: [{name: "guide.md", relPath: "docs/guide.md", isDirectory: false, ignored: true}],
				partial: false,
				capped: false,
			},
		});
	});

	it("rejects an invalid markIgnored flag", async () => {
		insertSession(root);
		expect(await request({markIgnored: "yes"})).toStrictEqual({
			status: 400,
			body: {error: "Invalid markIgnored flag"},
		});
	});

	it("rejects an invalid hideIgnored flag", async () => {
		insertSession(root);
		expect(await request({hideIgnored: "yes"})).toStrictEqual({
			status: 400,
			body: {error: "Invalid hideIgnored flag"},
		});
	});
});

describe("session files client", () => {
	it("parses every response kind strictly", () => {
		expect(SessionFilesResponseSchema.parse({kind: "no-cwd"})).toStrictEqual({kind: "no-cwd"});
		expect(() => SessionFilesResponseSchema.parse({kind: "no-cwd", extra: 1})).toThrow();
	});

	it("builds the query key and URL from the query-string parameters", () => {
		expect(sessionFilesQueryOptions("abc", {dir: "src", query: "", hideIgnored: true}).queryKey).toStrictEqual([
			"session-files",
			"abc",
			"src",
			"",
			true,
		]);
	});
});
