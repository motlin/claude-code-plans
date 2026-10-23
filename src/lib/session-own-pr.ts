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
 * The web URL of the GitHub repository a git remote URL points at, or null when it isn't GitHub. An ssh alias host
 * counts when its name mentions GitHub (e.g. `MotlinGitHub:owner/repo.git`), as the alias's real host is in ssh config.
 */
export function gitHubRepoUrl(remoteUrl: string): string | null {
	const trimmed = remoteUrl
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[/:]([^/]+)\/([^/]+)$/i.exec(trimmed);
	if (match === null) return null;
	const [, host = "", owner = "", repo = ""] = match;
	return /github/i.test(host) ? `https://github.com/${owner}/${repo}` : null;
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

function originUrlFromConfig(gitDir: string): string | null {
	let config: string;
	try {
		config = readFileSync(join(gitDir, "config"), "utf8");
	} catch {
		return null;
	}
	const section = /^\[remote "origin"\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(config)?.[1];
	const url = section === undefined ? undefined : /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1];
	return url === undefined ? null : url.trim();
}

/** How long a checkout's origin URL is reused before its git config is read again. */
const ORIGIN_CACHE_MS = 60_000;
const originCache = new Map<string, {url: string | null; readAt: number}>();

/** The `origin` remote URL of the checkout holding `path`, read from its git config rather than by spawning git and cached per path for a minute. */
function readOriginUrl(path: string, now: number): string | null {
	const cached = originCache.get(path);
	if (cached !== undefined && now - cached.readAt < ORIGIN_CACHE_MS) return cached.url;
	let url: string | null = null;
	try {
		const gitDir = gitDirOf(path);
		url = gitDir === null ? null : originUrlFromConfig(gitDir);
	} catch {
		url = null;
	}
	originCache.set(path, {url, readAt: now});
	return url;
}

/** The repo name of the `origin` remote of the checkout holding `path`, or null when it has none. */
export function readOriginRepoName(path: string, now = Date.now()): string | null {
	const url = readOriginUrl(path, now);
	return url === null ? null : gitRemoteRepoName(url);
}

/** The GitHub web URL of the `origin` remote of the checkout holding `path`, or null when it has none or isn't GitHub. */
export function readOriginGitHubUrl(path: string, now = Date.now()): string | null {
	const url = readOriginUrl(path, now);
	return url === null ? null : gitHubRepoUrl(url);
}
