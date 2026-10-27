import {execFileSync} from "node:child_process";
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {FolderPrSchema, homeFolderPrQueryOptions} from "../src/lib/api/home-folder-pr";
import {createFolderPrLookup, folderPrResponse, pickFolderPr} from "../src/lib/folder-pr";
import {parseGhFolderPrDetails} from "../src/lib/pr-details";
import type {GhRunner} from "../src/lib/pr-status-service";

function listRow(number: number, extra: {isDraft?: boolean; url?: string; title?: string} = {}) {
	return {
		number,
		title: extra.title ?? `PR ${number}`,
		url: extra.url ?? `https://github.com/acme/widgets/pull/${number}`,
		isDraft: extra.isDraft ?? false,
		headRefOid: `oid${number}`,
	};
}

interface Thread {
	isResolved: boolean;
	ids: (number | null)[];
}

function detailsReply({
	oid = "s",
	checks = [],
	threads = [],
}: {
	oid?: string;
	checks?: {name: string; conclusion: string | null}[];
	threads?: Thread[];
}) {
	return JSON.stringify({
		data: {
			repository: {
				pullRequest: {
					reviewThreads: {
						nodes: threads.map((thread) => ({
							isResolved: thread.isResolved,
							comments: {nodes: thread.ids.map((databaseId) => ({databaseId}))},
						})),
					},
					commits: {
						nodes: [
							{
								commit: {
									oid,
									statusCheckRollup: {
										contexts: {
											nodes: checks.map((check) => ({__typename: "CheckRun", ...check})),
										},
									},
								},
							},
						],
					},
				},
			},
		},
	});
}

describe("pickFolderPr", () => {
	it("keeps the highest-numbered open PR", () => {
		expect(pickFolderPr(JSON.stringify([listRow(5), listRow(7)]))).toStrictEqual({
			repo: "acme/widgets",
			number: 7,
			title: "PR 7",
			url: "https://github.com/acme/widgets/pull/7",
			headRefOid: "oid7",
		});
	});

	it("counts a draft PR", () => {
		expect(pickFolderPr(JSON.stringify([listRow(3, {isDraft: true})]))?.number).toBe(3);
	});

	it("is null for an empty list", () => {
		expect(pickFolderPr("[]")).toBeNull();
	});

	it("skips rows whose url is not a GitHub pull url", () => {
		expect(
			pickFolderPr(JSON.stringify([listRow(9, {url: "https://example.com/x/y/pull/9"}), listRow(2)]))?.number,
		).toBe(2);
	});
});

describe("parseGhFolderPrDetails", () => {
	it("stamps the head sha plus sorted failing names, naming the first failing check in rollup order", () => {
		expect(
			parseGhFolderPrDetails(
				detailsReply({
					oid: "s",
					checks: [
						{name: "ok", conclusion: "SUCCESS"},
						{name: "b", conclusion: "FAILURE"},
						{name: "a", conclusion: "TIMED_OUT"},
					],
				}),
			),
		).toStrictEqual({
			headSha: "s",
			failingChecks: ["b", "a"],
			unresolvedReviewThreads: 0,
			newestReviewCommentId: 0,
		});
	});

	it("counts unresolved threads and takes the newest comment id over every thread", () => {
		expect(
			parseGhFolderPrDetails(
				detailsReply({
					threads: [
						{isResolved: false, ids: [3, 9]},
						{isResolved: true, ids: [12, null]},
					],
				}),
			),
		).toStrictEqual({headSha: "s", failingChecks: [], unresolvedReviewThreads: 1, newestReviewCommentId: 12});
	});
});

describe("createFolderPrLookup", () => {
	function runner(reply: (args: string[]) => string): {runGh: GhRunner; calls: {args: string[]; cwd?: string}[]} {
		const calls: {args: string[]; cwd?: string}[] = [];
		const runGh: GhRunner = async (args, cwd) => {
			await Promise.resolve();
			calls.push(cwd === undefined ? {args} : {args, cwd});
			return reply(args);
		};
		return {runGh, calls};
	}

	it("lists the branch's open PRs in the folder, then fetches the chosen PR's details", async () => {
		const {runGh, calls} = runner((args) =>
			args[0] === "pr"
				? JSON.stringify([listRow(5), listRow(7, {title: "Add widgets"})])
				: detailsReply({
						oid: "s",
						checks: [
							{name: "b", conclusion: "FAILURE"},
							{name: "a", conclusion: "FAILURE"},
						],
						threads: [
							{isResolved: false, ids: [3, 9]},
							{isResolved: true, ids: [12]},
						],
					}),
		);
		const result = await createFolderPrLookup({runGh}).lookup("/repo", "feat");
		expect(result).toStrictEqual({
			status: "found",
			pr: {
				repo: "acme/widgets",
				number: 7,
				title: "Add widgets",
				branch: "feat",
				failing: true,
				failingCheckName: "b",
				failureStamp: "s\na\nb",
				unansweredReviewComments: 1,
				newestReviewCommentId: 12,
			},
		});
		expect(FolderPrSchema.parse(result)).toStrictEqual(result);
		expect(calls[0]).toStrictEqual({
			args: [
				"pr",
				"list",
				"--head",
				"feat",
				"--state",
				"open",
				"--json",
				"number,title,url,isDraft,headRefOid",
				"--limit",
				"20",
			],
			cwd: "/repo",
		});
		expect(calls[1]?.args.slice(0, 8)).toStrictEqual([
			"api",
			"graphql",
			"-f",
			"owner=acme",
			"-f",
			"repo=widgets",
			"-F",
			"number=7",
		]);
		expect(calls).toHaveLength(2);
	});

	it("omits the check name and stamps only the sha when nothing fails", async () => {
		const {runGh} = runner((args) => (args[0] === "pr" ? JSON.stringify([listRow(4)]) : detailsReply({oid: "h"})));
		expect(await createFolderPrLookup({runGh}).lookup("/repo", "feat")).toStrictEqual({
			status: "found",
			pr: {
				repo: "acme/widgets",
				number: 4,
				title: "PR 4",
				branch: "feat",
				failing: false,
				failureStamp: "h",
				unansweredReviewComments: 0,
				newestReviewCommentId: 0,
			},
		});
	});

	it("is none for an empty list, without a details call", async () => {
		const {runGh, calls} = runner(() => "[]");
		expect(await createFolderPrLookup({runGh}).lookup("/repo", "feat")).toStrictEqual({status: "none"});
		expect(calls).toHaveLength(1);
	});

	it("is off when gh throws, and backs off before asking again", async () => {
		let now = 0;
		let runs = 0;
		const lookup = createFolderPrLookup({
			runGh: async () => {
				await Promise.resolve();
				runs += 1;
				throw new Error("gh: not logged in");
			},
			now: () => now,
		});
		expect(await lookup.lookup("/repo", "feat")).toStrictEqual({status: "off"});
		expect(await lookup.lookup("/repo", "feat")).toStrictEqual({status: "off"});
		expect(runs).toBe(1);
		now = 60_000;
		expect(await lookup.lookup("/repo", "feat")).toStrictEqual({status: "off"});
		expect(runs).toBe(2);
	});

	it("is off when the details call fails", async () => {
		const {runGh} = runner((args) => {
			if (args[0] === "pr") return JSON.stringify([listRow(4)]);
			throw new Error("graphql failed");
		});
		expect(await createFolderPrLookup({runGh}).lookup("/repo", "feat")).toStrictEqual({status: "off"});
	});

	it("runs gh one command at a time", async () => {
		let active = 0;
		let maxActive = 0;
		const lookup = createFolderPrLookup({
			runGh: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => {
					setTimeout(resolve, 5);
				});
				active -= 1;
				return "[]";
			},
		});
		await Promise.all([lookup.lookup("/a", "x"), lookup.lookup("/b", "y"), lookup.lookup("/c", "z")]);
		expect(maxActive).toBe(1);
	});
});

describe("folderPrResponse", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = realpathSync(mkdtempSync(join(tmpdir(), "folder-pr-test-")));
	});

	afterEach(() => {
		rmSync(tempDir, {recursive: true, force: true});
	});

	function recordingLookup() {
		const calls: [string, string][] = [];
		return {
			calls,
			lookup: {
				lookup: async (folder: string, branch: string) => {
					await Promise.resolve();
					calls.push([folder, branch]);
					return {status: "none" as const};
				},
			},
		};
	}

	async function get(params: Record<string, string>, lookup: ReturnType<typeof recordingLookup>["lookup"]) {
		const url = new URL("http://localhost/api/home/folder-pr");
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		return folderPrResponse(new Request(url), lookup);
	}

	it("looks up an existing directory's branch in a real temp git repo", async () => {
		execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], {cwd: tempDir});
		const {calls, lookup} = recordingLookup();
		const response = await get({path: tempDir, branch: "feat/x"}, lookup);
		expect(response.status).toBe(200);
		expect(await response.json()).toStrictEqual({status: "none"});
		expect(calls).toStrictEqual([[tempDir, "feat/x"]]);
	});

	it.each([
		["a relative path", {path: "projects/foo", branch: "feat"}],
		["a missing path", {branch: "feat"}],
		["a missing branch", {path: "TEMP"}],
		["an empty branch", {path: "TEMP", branch: ""}],
		["an option-like branch", {path: "TEMP", branch: "--help"}],
		["a branch with whitespace", {path: "TEMP", branch: "a b"}],
		["a .. path", {path: "TEMP/../TEMP", branch: "feat"}],
		["a missing directory", {path: "TEMP/nope", branch: "feat"}],
		["a file", {path: "TEMP/file.txt", branch: "feat"}],
	])("rejects %s with 400 without running gh", async (_name, params) => {
		writeFileSync(join(tempDir, "file.txt"), "x");
		const {calls, lookup} = recordingLookup();
		const resolved = Object.fromEntries(
			Object.entries(params).map(([key, value]) => [key, value.replaceAll("TEMP", tempDir)]),
		);
		expect((await get(resolved, lookup)).status).toBe(400);
		expect(calls).toStrictEqual([]);
	});
});

describe("homeFolderPrQueryOptions", () => {
	it("keys by folder and branch, stays fresh for 120s, and waits for both", () => {
		const options = homeFolderPrQueryOptions("/p", "feat");
		expect(options.queryKey).toStrictEqual(["home", "folder-pr", "/p", "feat"]);
		expect(options.staleTime).toBe(120_000);
		expect(options.enabled).toBe(true);
		expect(homeFolderPrQueryOptions(undefined, "feat").enabled).toBe(false);
		expect(homeFolderPrQueryOptions("/p", null).enabled).toBe(false);
	});
});
