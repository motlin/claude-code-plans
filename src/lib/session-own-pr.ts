import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import type {SessionPrLink} from "./sessions";

/** The repository name a git remote URL points at (ssh, ssh-alias or https), or null for an empty one. */
export function gitRemoteRepoName(remoteUrl: string): string | null {
	const trimmed = remoteUrl
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	const name = trimmed.split(/[/:]/).pop();
	return name === undefined || name === "" ? null : name;
}

/**
 * The session's PR link when it belongs to the session's own repository (or a
 * fork of it, which shares the name). A session that only opened or touched a
 * PR in another repository keeps no PR, as upstream shows no badge or strip for
 * it. Without a known remote the link is kept.
 */
export function ownRepositoryPr(pr: SessionPrLink, remoteRepoName: string | null): SessionPrLink | null {
	if (remoteRepoName === null) return pr;
	const prRepoName = pr.repository.slice(pr.repository.lastIndexOf("/") + 1);
	return prRepoName.toLowerCase() === remoteRepoName.toLowerCase() ? pr : null;
}

/** The `.git` directory of a checkout, following a worktree's `gitdir:` pointer file. */
async function gitDirOf(projectPath: string): Promise<string | null> {
	const dotGit = join(projectPath, ".git");
	try {
		const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, "utf8"));
		if (pointer?.[1] === undefined) return null;
		// A worktree's gitdir sits under the main repo's .git/worktrees; its config lives two levels up.
		const gitDir = resolve(projectPath, pointer[1].trim());
		return /[/\\]worktrees[/\\][^/\\]+$/.test(gitDir) ? resolve(gitDir, "..", "..") : gitDir;
	} catch (error) {
		// EISDIR: an ordinary checkout, whose .git is the directory itself.
		return error instanceof Error && "code" in error && error.code === "EISDIR" ? dotGit : null;
	}
}

/**
 * The repo name of the checkout's `origin` remote, read from its git config
 * rather than by spawning git, or null when it has none.
 */
export async function readOriginRepoName(projectPath: string): Promise<string | null> {
	const gitDir = await gitDirOf(projectPath);
	if (gitDir === null) return null;
	let config: string;
	try {
		config = await readFile(join(gitDir, "config"), "utf8");
	} catch {
		return null;
	}
	const section = /^\[remote "origin"\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(config)?.[1];
	const url = section === undefined ? undefined : /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1];
	return url === undefined ? null : gitRemoteRepoName(url);
}
