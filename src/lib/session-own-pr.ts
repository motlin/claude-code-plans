import {readFileSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
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

/** The `.git` directory of the checkout holding `path`, searching upward and following a worktree's `gitdir:` file. */
function gitDirOf(path: string): string | null {
	for (let dir = resolve(path); ; dir = dirname(dir)) {
		const dotGit = join(dir, ".git");
		let stats;
		try {
			stats = statSync(dotGit);
		} catch {
			stats = null;
		}
		if (stats?.isDirectory() === true) return dotGit;
		if (stats?.isFile() === true) {
			const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
			if (pointer?.[1] === undefined) return null;
			// A worktree's gitdir sits under the main repo's .git/worktrees; its config lives two levels up.
			const gitDir = resolve(dir, pointer[1].trim());
			return /[/\\]worktrees[/\\][^/\\]+$/.test(gitDir) ? resolve(gitDir, "..", "..") : gitDir;
		}
		if (dirname(dir) === dir) return null;
	}
}

function originFromConfig(gitDir: string): string | null {
	let config: string;
	try {
		config = readFileSync(join(gitDir, "config"), "utf8");
	} catch {
		return null;
	}
	const section = /^\[remote "origin"\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(config)?.[1];
	const url = section === undefined ? undefined : /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1];
	return url === undefined ? null : gitRemoteRepoName(url);
}

/** How long a checkout's origin name is reused before its git config is read again. */
const ORIGIN_CACHE_MS = 60_000;
const originCache = new Map<string, {name: string | null; readAt: number}>();

/**
 * The repo name of the `origin` remote of the checkout holding `path`, read from
 * its git config rather than by spawning git and cached per path for a minute,
 * or null when it has none.
 */
export function readOriginRepoName(path: string, now = Date.now()): string | null {
	const cached = originCache.get(path);
	if (cached !== undefined && now - cached.readAt < ORIGIN_CACHE_MS) return cached.name;
	let name: string | null = null;
	try {
		const gitDir = gitDirOf(path);
		name = gitDir === null ? null : originFromConfig(gitDir);
	} catch {
		name = null;
	}
	originCache.set(path, {name, readAt: now});
	return name;
}
