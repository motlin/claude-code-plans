import {CHANGED_FILE_KINDS, type ChangedFileKind} from "../../lib/changed-file-kind";

export interface ChangedFileInput {
	path: string;
	additions: number;
	deletions: number;
}

export interface ChangedFileTreeFile {
	type: "file";
	path: string;
	name: string;
	/** Parent directory ("" at the repo root); shown as a muted suffix in the flat list. */
	dir: string;
	depth: number;
	additions: number;
	deletions: number;
}

export interface ChangedFileTreeDir {
	type: "dir";
	path: string;
	/** Compacted single-child chain relative to the parent, e.g. ".github/workflows". */
	name: string;
	depth: number;
	children: ChangedFileTreeNode[];
}

export type ChangedFileTreeNode = ChangedFileTreeDir | ChangedFileTreeFile;

export interface ChangedFileTreeSection {
	/** Null when files are not separated by kind. */
	kind: ChangedFileKind | null;
	nodes: ChangedFileTreeNode[];
}

export interface ChangedFileTreeOptions {
	groupByFolder: boolean;
	groupByKind: boolean;
}

const TEST_DIR = /(^|\/)(tests?|__tests__|spec)\//;
const TEST_FILE = /\.(test|spec)\./;
const GENERATED_DIR = /(^|\/)(dist|\.output|__snapshots__)\//;
const BUILD_DIR = /(^|\/)\.github\//;
const BUILD_FILE =
	/^(package\.json|pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|bun\.lockb|go\.sum|[jJ]ustfile|Dockerfile(\..+)?|vite\.config\..+|.+\.lock|.+\.toml)$/;

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** Path heuristics for upstream's "Test files", "Build files" and "Generated files" sections. */
export function classifyChangedFile(path: string): ChangedFileKind {
	const name = baseName(path);
	if (GENERATED_DIR.test(path) || name.includes(".gen.")) return "generated";
	if (TEST_DIR.test(path) || TEST_FILE.test(name)) return "test";
	if (BUILD_DIR.test(path) || BUILD_FILE.test(name)) return "build";
	return "source";
}

function fileNode(file: ChangedFileInput, depth: number): ChangedFileTreeFile {
	const slash = file.path.lastIndexOf("/");
	return {
		type: "file",
		path: file.path,
		name: file.path.slice(slash + 1),
		dir: slash === -1 ? "" : file.path.slice(0, slash),
		depth,
		additions: file.additions,
		deletions: file.deletions,
	};
}

interface Trie {
	dirs: Map<string, Trie>;
	files: ChangedFileInput[];
}

function byName(a: string, b: string): number {
	if (a < b) return -1;
	return a > b ? 1 : 0;
}

function trieNodes(trie: Trie, parentPath: string, depth: number): ChangedFileTreeNode[] {
	const dirs = [...trie.dirs.entries()]
		.toSorted(([a], [b]) => byName(a, b))
		.map(([segment, initial]): ChangedFileTreeDir => {
			let name = segment;
			let child = initial;
			while (child.files.length === 0 && child.dirs.size === 1) {
				const [only] = child.dirs;
				if (only === undefined) break;
				name = `${name}/${only[0]}`;
				child = only[1];
			}
			const path = parentPath === "" ? name : `${parentPath}/${name}`;
			return {type: "dir", path, name, depth, children: trieNodes(child, path, depth + 1)};
		});
	const files = [...trie.files]
		.toSorted((a, b) => byName(baseName(a.path), baseName(b.path)))
		.map((file) => fileNode(file, depth));
	return [...dirs, ...files];
}

function folderNodes(files: readonly ChangedFileInput[]): ChangedFileTreeNode[] {
	const root: Trie = {dirs: new Map(), files: []};
	for (const file of files) {
		let trie = root;
		for (const segment of file.path.split("/").slice(0, -1)) {
			let next = trie.dirs.get(segment);
			if (next === undefined) {
				next = {dirs: new Map(), files: []};
				trie.dirs.set(segment, next);
			}
			trie = next;
		}
		trie.files.push(file);
	}
	return trieNodes(root, "", 0);
}

/**
 * The Changes pane file list: a folder tree with single-child directory chains compacted
 * (`.github/workflows`), or a flat list in diff order, optionally split into trailing
 * test/build/generated sections.
 */
export function buildChangedFileTree(
	files: readonly ChangedFileInput[],
	{groupByFolder, groupByKind}: ChangedFileTreeOptions,
): ChangedFileTreeSection[] {
	const nodesOf = (subset: readonly ChangedFileInput[]) =>
		groupByFolder ? folderNodes(subset) : subset.map((file) => fileNode(file, 0));
	if (!groupByKind) return files.length === 0 ? [] : [{kind: null, nodes: nodesOf(files)}];
	return CHANGED_FILE_KINDS.flatMap((kind) => {
		const subset = files.filter((file) => classifyChangedFile(file.path) === kind);
		return subset.length === 0 ? [] : [{kind, nodes: nodesOf(subset)}];
	});
}
