import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {gitRemoteRepoName, ownRepositoryPr, readOriginRepoName} from "../src/lib/session-own-pr";
import {toSessionSummaryPayload} from "../src/lib/session-summary";

const FOREIGN = {
	number: 5,
	url: "https://github.com/motlin/playdate-template/pull/5",
	repository: "motlin/playdate-template",
};
const OWN = {number: 838, url: "https://github.com/liftwizard/klass/pull/838", repository: "liftwizard/klass"};
const FORK = {number: 839, url: "https://github.com/motlin/klass/pull/839", repository: "motlin/klass"};

describe("gitRemoteRepoName", () => {
	it("reads the repo name from ssh, ssh-alias and https remotes", () => {
		expect([
			gitRemoteRepoName("git@github.com:liftwizard/klass.git"),
			gitRemoteRepoName("MotlinGitHub:liftwizard/klass.git"),
			gitRemoteRepoName("https://github.com/liftwizard/klass"),
			gitRemoteRepoName("  \n"),
		]).toStrictEqual(["klass", "klass", "klass", null]);
	});
});

describe("ownRepositoryPr", () => {
	it("keeps a PR in the session's own repo, or a fork of it, and drops one the session only touched in another repo", () => {
		expect({
			foreign: ownRepositoryPr(FOREIGN, "klass"),
			own: ownRepositoryPr(OWN, "klass"),
			fork: ownRepositoryPr(FORK, "Klass"),
			unknownRemote: ownRepositoryPr(FOREIGN, null),
		}).toStrictEqual({foreign: null, own: OWN, fork: FORK, unknownRemote: FOREIGN});
	});
});

describe("readOriginRepoName", () => {
	it("reads origin's repo name from the checkout's git config, from any directory inside it and through a worktree's gitdir file, without spawning git", () => {
		const root = mkdtempSync(join(tmpdir(), "own-pr-"));
		try {
			const main = join(root, "klass");
			mkdirSync(join(main, ".git", "worktrees", "wt"), {recursive: true});
			writeFileSync(
				join(main, ".git", "config"),
				'[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/other/thing.git\n[remote "origin"]\n\turl = MotlinGitHub:liftwizard/klass.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
			);
			const worktree = join(root, "klass-wt");
			mkdirSync(worktree);
			writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
			const plain = join(root, "plain");
			mkdirSync(plain);

			mkdirSync(join(main, "src", "deep"), {recursive: true});

			expect([
				readOriginRepoName(main),
				readOriginRepoName(worktree),
				readOriginRepoName(join(main, "src", "deep")),
				readOriginRepoName(plain),
			]).toStrictEqual(["klass", "klass", "klass", null]);
		} finally {
			rmSync(root, {recursive: true, force: true});
		}
	});
});

describe("session list PR fields", () => {
	it("drop a PR the session only touched in another repository, so home and the sidebar agree with session detail", () => {
		const root = mkdtempSync(join(tmpdir(), "own-pr-summary-"));
		try {
			const checkout = join(root, "klass");
			mkdirSync(join(checkout, ".git"), {recursive: true});
			writeFileSync(
				join(checkout, ".git", "config"),
				'[remote "origin"]\n\turl = MotlinGitHub:liftwizard/klass.git\n',
			);
			const entry = {
				id: "session-own-pr",
				title: "Klass #838 sync java-template",
				mtime: new Date("2026-10-13T22:44:00.000Z"),
				created: new Date("2026-10-13T20:00:00.000Z"),
				project: "-tmp-klass",
				projectName: "klass",
				messageCount: 3,
				cwd: checkout,
				isSidechain: false,
			};
			const summary = (pr: typeof FOREIGN) =>
				toSessionSummaryPayload({...entry, pr}, {activeSession: null, registrySession: null});

			expect({foreign: summary(FOREIGN).pr, own: summary(OWN).pr}).toStrictEqual({foreign: undefined, own: OWN});
		} finally {
			rmSync(root, {recursive: true, force: true});
		}
	});
});
