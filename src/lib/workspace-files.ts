import {spawn} from "node:child_process";
import type {Dirent} from "node:fs";
import {readdir, readlink, realpath, stat} from "node:fs/promises";
import {isAbsolute, join, relative, sep} from "node:path";
import {searchPaths} from "./fuzzy-path";

/** A directory listing stops here and reports `partial`. */
const LIST_DIR_CAP = 1000;
/** A workspace walk for fuzzy search stops after this many entries and reports `partial`. */
const WALK_CAP = 20_000;
/** Fuzzy search returns at most this many paths. */
const FUZZY_RESULT_CAP = 50;

/** The walk lists these directories but never descends into them. */
const UNWALKED_DIRECTORIES = new Set([".git"]);

export class WorkspacePathError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "WorkspacePathError";
	}
}

export interface WorkspaceSymlink {
	/** The link text as written, relative or absolute. */
	target: string;
	/** The resolved target lies outside the working directory. */
	outside: boolean;
	/** The target does not resolve (missing or circular). */
	broken: boolean;
}

export interface WorkspaceEntry {
	name: string;
	/** Slash-separated path relative to the working directory. */
	relPath: string;
	isDirectory: boolean;
	symlink?: WorkspaceSymlink;
}

export interface WorkspaceListing {
	entries: WorkspaceEntry[];
	partial: boolean;
}

/** Returns the subset of `relPaths` that git ignores in `root`. */
export type IgnoreCheck = (root: string, relPaths: readonly string[]) => Promise<Set<string>>;

export interface ListOptions {
	cap?: number;
	/** When set, entries it reports are left out (and never walked into). */
	ignored?: IgnoreCheck;
}

export function isContainedPath(path: string, root: string): boolean {
	const relativePath = relative(root, path);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

function joinRel(dir: string, name: string): string {
	return dir === "" ? name : `${dir}/${name}`;
}

function compareEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
	if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
	const left = a.name.toLowerCase();
	const right = b.name.toLowerCase();
	if (left !== right) return left < right ? -1 : 1;
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Resolve `rel` (slash-separated, relative to `root`) to a real directory
 * inside `root`. Absolute paths and `..` segments are refused outright, and
 * the resolved path must still sit inside the resolved root.
 */
async function resolveDirectoryUnderRoot(root: string, rel: string): Promise<string> {
	if (isAbsolute(rel) || rel.includes("\0") || rel.split(/[/\\]/).some((segment) => segment === "..")) {
		throw new WorkspacePathError("A relative path inside the working directory is required", 403);
	}
	let resolved: string;
	try {
		resolved = await realpath(join(root, rel));
	} catch {
		throw new WorkspacePathError("Directory not found", 404);
	}
	if (!isContainedPath(resolved, root)) {
		throw new WorkspacePathError("Directory is outside the working directory", 403);
	}
	if (!(await stat(resolved)).isDirectory()) {
		throw new WorkspacePathError("Directory not found", 404);
	}
	return resolved;
}

async function toEntry(root: string, directory: string, rel: string, dirent: Dirent): Promise<WorkspaceEntry> {
	const relPath = joinRel(rel, dirent.name);
	if (!dirent.isSymbolicLink()) {
		return {name: dirent.name, relPath, isDirectory: dirent.isDirectory()};
	}
	const path = join(directory, dirent.name);
	const target = await readlink(path);
	try {
		const resolved = await realpath(path);
		const isDirectory = (await stat(resolved)).isDirectory();
		return {
			name: dirent.name,
			relPath,
			isDirectory,
			symlink: {target, outside: !isContainedPath(resolved, root), broken: false},
		};
	} catch {
		return {
			name: dirent.name,
			relPath,
			isDirectory: false,
			symlink: {target, outside: false, broken: true},
		};
	}
}

async function readEntries(root: string, directory: string, rel: string): Promise<WorkspaceEntry[]> {
	const dirents = await readdir(directory, {withFileTypes: true});
	const entries = await Promise.all(dirents.map((dirent) => toEntry(root, directory, rel, dirent)));
	return entries.sort(compareEntries);
}

async function dropIgnored(
	root: string,
	entries: WorkspaceEntry[],
	ignored: IgnoreCheck | undefined,
): Promise<WorkspaceEntry[]> {
	if (ignored === undefined || entries.length === 0) return entries;
	const ignoredPaths = await ignored(
		root,
		entries.map((entry) => entry.relPath),
	);
	return entries.filter((entry) => !ignoredPaths.has(entry.relPath));
}

/**
 * List one directory of the workspace rooted at the real path `root`,
 * including hidden and (unless `ignored` is given) gitignored entries.
 * Directories come first, then case-insensitive name order.
 */
export async function listDir(root: string, rel: string, options: ListOptions = {}): Promise<WorkspaceListing> {
	const cap = options.cap ?? LIST_DIR_CAP;
	const directory = await resolveDirectoryUnderRoot(root, rel);
	const normalizedRel = relative(root, directory).split(sep).join("/");
	const entries = await dropIgnored(root, await readEntries(root, directory, normalizedRel), options.ignored);
	return {entries: entries.slice(0, cap), partial: entries.length > cap};
}

/**
 * Walk the workspace breadth-first from `rel`, listing each level in
 * `listDir` order. Symlinks are listed but never followed, and `.git` is
 * listed but not walked into.
 */
export async function walkWorkspace(root: string, rel: string, options: ListOptions = {}): Promise<WorkspaceListing> {
	const cap = options.cap ?? WALK_CAP;
	const start = await resolveDirectoryUnderRoot(root, rel);
	const entries: WorkspaceEntry[] = [];
	let level = [relative(root, start).split(sep).join("/")];
	while (level.length > 0) {
		let levelEntries: WorkspaceEntry[] = [];
		for (const directory of level) {
			try {
				levelEntries.push(...(await readEntries(root, join(root, directory), directory)));
			} catch {
				// A directory that vanished or is unreadable mid-walk is skipped.
			}
		}
		levelEntries = await dropIgnored(root, levelEntries, options.ignored);
		for (const entry of levelEntries) {
			if (entries.length >= cap) return {entries, partial: true};
			entries.push(entry);
		}
		level = levelEntries
			.filter(
				(entry) => entry.isDirectory && entry.symlink === undefined && !UNWALKED_DIRECTORIES.has(entry.name),
			)
			.map((entry) => entry.relPath);
	}
	return {entries, partial: false};
}

/** Fuzzy subsequence match over paths, best first, at most `cap` of them. */
export function fuzzyFilePaths(
	query: string,
	paths: readonly string[],
	cap: number = FUZZY_RESULT_CAP,
): {paths: string[]; partial: boolean} {
	const {results, more} = searchPaths(query, paths, cap);
	return {paths: results.map((result) => result.path), partial: more > 0};
}

/**
 * `git check-ignore` over `relPaths` in `root`. Outside a git repository (or
 * when git fails) nothing is reported as ignored.
 */
export const gitCheckIgnored: IgnoreCheck = (root, relPaths) =>
	new Promise((resolve) => {
		const child = spawn("git", ["check-ignore", "--stdin", "-z"], {
			cwd: root,
			stdio: ["pipe", "pipe", "ignore"],
		});
		const chunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.on("error", () => resolve(new Set()));
		child.on("close", (code) => {
			if (code !== 0 && code !== 1) {
				resolve(new Set());
				return;
			}
			const output = Buffer.concat(chunks).toString("utf8");
			resolve(new Set(output.split("\0").filter((path) => path !== "")));
		});
		child.stdin.on("error", () => {});
		child.stdin.end(relPaths.map((path) => `${path}\0`).join(""));
	});
