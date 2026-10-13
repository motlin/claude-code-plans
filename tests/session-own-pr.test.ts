import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {gitRemoteRepoName, ownRepositoryPr, readOriginRepoName} from "../src/lib/session-own-pr";

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
	it("reads origin's repo name from the checkout's git config, following a worktree's gitdir file, without spawning git", async () => {
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

			expect([
				await readOriginRepoName(main),
				await readOriginRepoName(worktree),
				await readOriginRepoName(plain),
			]).toStrictEqual(["klass", "klass", null]);
		} finally {
			rmSync(root, {recursive: true, force: true});
		}
	});
});
