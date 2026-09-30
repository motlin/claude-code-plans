import {execFile} from "node:child_process";

const MAX_GIT_OUTPUT_BYTES = 100 * 1024 * 1024;
const COMMIT_LIST_CAP = 50;
const DEFAULT_BRANCH_CANDIDATES = ["main", "master"] as const;
const STABLE_DIFF_ARGUMENTS = ["--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-M"];

export interface RunGitOptions {
	/** Treat exit code 1 as success (git diff --no-index exits 1 when files differ). */
	allowDifferences?: boolean;
}

/** Runs git with an argv array (never a shell) and resolves to stdout. */
export type RunGit = (cwd: string, arguments_: string[], options?: RunGitOptions) => Promise<string>;

const execRunGit: RunGit = (cwd, arguments_, options = {}) =>
	new Promise((resolve, reject) => {
		execFile("git", arguments_, {cwd, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES}, (error, stdout) => {
			if (error && !(options.allowDifferences === true && error.code === 1)) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});

export interface NoGit {
	kind: "no-git";
}

export interface DiffBase {
	kind: "ok";
	/** Display name of the default branch, e.g. "main". */
	base: string;
	/** The ref the merge-base was computed against, e.g. "origin/main". */
	baseRef: string;
	mergeBase: string;
}

export interface CommitSummary {
	sha: string;
	shortSha: string;
	subject: string;
	author: string;
	/** Strict ISO 8601 author date. */
	date: string;
}

export interface DiffScopes extends Omit<DiffBase, "kind"> {
	kind: "ok";
	/** Current branch name, or null when HEAD is detached. */
	head: string | null;
	uncommittedAvailable: boolean;
	/** Newest first, capped at 50. */
	commits: CommitSummary[];
	totalCommits: number;
}

export type DiffScope = {kind: "branch"} | {kind: "uncommitted"} | {kind: "commit"; sha: string};

export interface ScopeDiffOptions {
	hideWhitespace?: boolean;
}

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
	path: string;
	oldPath?: string;
	status: DiffFileStatus;
	additions: number;
	deletions: number;
	binary: boolean;
	patch: string;
}

export interface ScopeDiff {
	kind: "ok";
	patch: string;
	files: DiffFile[];
}

async function tryGit(runGit: RunGit, cwd: string, arguments_: string[]): Promise<string | null> {
	try {
		return (await runGit(cwd, arguments_)).trim();
	} catch {
		return null;
	}
}

async function isGitWorkTree(runGit: RunGit, cwd: string): Promise<boolean> {
	return (await tryGit(runGit, cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
}

async function findDefaultBranchRef(runGit: RunGit, cwd: string): Promise<string | null> {
	const originHead = await tryGit(runGit, cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (originHead) return originHead;

	for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
		const sha = await tryGit(runGit, cwd, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
		if (sha) return candidate;
	}
	return null;
}

async function resolveBaseInRepository(runGit: RunGit, cwd: string): Promise<Omit<DiffBase, "kind">> {
	const baseRef = await findDefaultBranchRef(runGit, cwd);
	if (baseRef) {
		const mergeBase = await tryGit(runGit, cwd, ["merge-base", baseRef, "HEAD"]);
		if (mergeBase) {
			return {base: baseRef.replace(/^origin\//, ""), baseRef, mergeBase};
		}
	}

	// No default branch (or unrelated history): diff against HEAD, or the empty tree before the first commit.
	const head = await tryGit(runGit, cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
	if (head) return {base: "HEAD", baseRef: "HEAD", mergeBase: head};
	const emptyTree = await runGit(cwd, ["hash-object", "-t", "tree", "/dev/null"]);
	return {base: "HEAD", baseRef: "HEAD", mergeBase: emptyTree.trim()};
}

/** Resolve the default branch (origin/HEAD, then main, then master) and its merge-base with HEAD. */
export async function resolveDiffBase(cwd: string, runGit: RunGit = execRunGit): Promise<DiffBase | NoGit> {
	if (!(await isGitWorkTree(runGit, cwd))) return {kind: "no-git"};
	return {kind: "ok", ...(await resolveBaseInRepository(runGit, cwd))};
}

function parseCommitLog(output: string): CommitSummary[] {
	return output
		.split("\0")
		.filter((record) => record.trim() !== "")
		.map((record) => {
			const [sha = "", shortSha = "", subject = "", author = "", date = ""] = record
				.replace(/^\n/, "")
				.split("\u001F");
			return {sha, shortSha, subject, author, date};
		});
}

/** List the scopes the Changes pane offers: branch vs base, uncommitted, and per-commit. */
export async function listScopes(cwd: string, runGit: RunGit = execRunGit): Promise<DiffScopes | NoGit> {
	const resolved = await resolveDiffBase(cwd, runGit);
	if (resolved.kind === "no-git") return resolved;

	const head = await tryGit(runGit, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	const status = await runGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
	const hasHead = (await tryGit(runGit, cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])) !== null;

	let commits: CommitSummary[] = [];
	let totalCommits = 0;
	if (hasHead) {
		const range = `${resolved.mergeBase}..HEAD`;
		const log = await runGit(cwd, [
			"log",
			"-z",
			`--max-count=${COMMIT_LIST_CAP}`,
			"--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI",
			range,
			"--",
		]);
		commits = parseCommitLog(log);
		totalCommits = Number.parseInt((await runGit(cwd, ["rev-list", "--count", range, "--"])).trim(), 10);
	}

	return {
		kind: "ok",
		base: resolved.base,
		baseRef: resolved.baseRef,
		mergeBase: resolved.mergeBase,
		head: head || null,
		uncommittedAvailable: status.trim() !== "",
		commits,
		totalCommits,
	};
}

async function untrackedDiffs(runGit: RunGit, cwd: string, whitespace: string[]): Promise<string[]> {
	const untracked = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
	const parts: string[] = [];
	for (const file of untracked.split("\0").filter(Boolean)) {
		parts.push(
			await runGit(
				cwd,
				["diff", ...STABLE_DIFF_ARGUMENTS, ...whitespace, "--no-index", "--", "/dev/null", file],
				{allowDifferences: true},
			),
		);
	}
	return parts;
}

/** Build the unified patch and per-file breakdown for one scope of the session's checkout. */
export async function buildScopeDiff(
	cwd: string,
	scope: DiffScope,
	options: ScopeDiffOptions = {},
	runGit: RunGit = execRunGit,
): Promise<ScopeDiff | NoGit> {
	if (!(await isGitWorkTree(runGit, cwd))) return {kind: "no-git"};
	const whitespace = options.hideWhitespace === true ? ["-w"] : [];

	let parts: string[];
	switch (scope.kind) {
		case "branch": {
			const {mergeBase} = await resolveBaseInRepository(runGit, cwd);
			const tracked = await runGit(cwd, ["diff", ...STABLE_DIFF_ARGUMENTS, ...whitespace, mergeBase, "--"]);
			parts = [tracked, ...(await untrackedDiffs(runGit, cwd, whitespace))];
			break;
		}
		case "uncommitted": {
			const tracked = await runGit(cwd, ["diff", ...STABLE_DIFF_ARGUMENTS, ...whitespace, "HEAD", "--"]);
			parts = [tracked, ...(await untrackedDiffs(runGit, cwd, whitespace))];
			break;
		}
		case "commit": {
			parts = [
				await runGit(cwd, ["show", "--format=", ...STABLE_DIFF_ARGUMENTS, ...whitespace, scope.sha, "--"]),
			];
			break;
		}
	}

	const patch = parts.join("");
	return {kind: "ok", patch, files: parseDiffFiles(patch)};
}

const C_ESCAPES: Record<string, number> = {
	a: 7,
	b: 8,
	t: 9,
	n: 10,
	v: 11,
	f: 12,
	r: 13,
	'"': 34,
	"\\": 92,
};

/** Decode a git C-quoted string that starts with a double quote, stopping at the closing quote. */
function unquote(text: string): string {
	const bytes: number[] = [];
	let index = 1;
	while (index < text.length && text[index] !== '"') {
		const character = text[index] ?? "";
		if (character === "\\") {
			const next = text[index + 1] ?? "";
			if (/[0-7]/.test(next)) {
				bytes.push(Number.parseInt(text.slice(index + 1, index + 4), 8));
				index += 4;
				continue;
			}
			bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
			index += 2;
			continue;
		}
		bytes.push(...Buffer.from(character, "utf8"));
		index += 1;
	}
	return Buffer.from(bytes).toString("utf8");
}

/** Decode a header path value: unquote if C-quoted and strip the given prefix. */
function decodePath(raw: string, prefix: string): string {
	const value = raw.startsWith('"') ? unquote(raw) : raw.replace(/\t$/, "");
	return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Recover the path from a `diff --git a/X b/X` line when there are no ---/+++ or rename lines. */
function pathFromDiffGitLine(line: string): string {
	const rest = line.slice("diff --git ".length);
	if (rest.startsWith('"')) return decodePath(rest, "a/");
	// Both sides are equal for non-renames, so the line is `a/P b/P`.
	const pathLength = (rest.length - 5) / 2;
	return rest.slice(2, 2 + pathLength);
}

function parseFileChunk(lines: string[]): DiffFile {
	let status: DiffFileStatus = "modified";
	let oldPath: string | undefined;
	let newPath: string | undefined;
	let minusPath: string | undefined;
	let plusPath: string | undefined;
	let additions = 0;
	let deletions = 0;
	let binary = false;
	let inHunk = false;

	for (const line of lines.slice(1)) {
		if (inHunk) {
			if (line.startsWith("+")) additions += 1;
			else if (line.startsWith("-")) deletions += 1;
			continue;
		}
		if (line.startsWith("@@")) inHunk = true;
		else if (line.startsWith("new file mode")) status = "added";
		else if (line.startsWith("deleted file mode")) status = "deleted";
		else if (line.startsWith("rename from ")) oldPath = decodePath(line.slice("rename from ".length), "");
		else if (line.startsWith("rename to ")) newPath = decodePath(line.slice("rename to ".length), "");
		else if (line.startsWith("--- ")) minusPath = decodePath(line.slice(4), "a/");
		else if (line.startsWith("+++ ")) plusPath = decodePath(line.slice(4), "b/");
		else if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
	}

	const firstLine = lines[0] ?? "";
	let path: string;
	if (newPath !== undefined && oldPath !== undefined) {
		status = "renamed";
		path = newPath;
	} else if (plusPath !== undefined && plusPath !== "/dev/null") {
		path = plusPath;
	} else if (minusPath !== undefined && minusPath !== "/dev/null") {
		path = minusPath;
	} else {
		path = pathFromDiffGitLine(firstLine);
	}

	const common = {status, additions, deletions, binary, patch: `${lines.join("\n")}\n`};
	return status === "renamed" && oldPath !== undefined ? {path, oldPath, ...common} : {path, ...common};
}

/** Split a multi-file unified git patch into per-file entries with status and line stats. */
export function parseDiffFiles(patch: string): DiffFile[] {
	const lines = patch.split("\n");
	if (lines.at(-1) === "") lines.pop();

	const chunks: string[][] = [];
	for (const line of lines) {
		if (line.startsWith("diff --git ")) chunks.push([line]);
		else chunks.at(-1)?.push(line);
	}
	return chunks.map((chunk) => parseFileChunk(chunk));
}
