import type {FileTreeNodeData} from "../../lib/api/plugins";

/** Root files upstream pins above everything else, in this order. */
const PRIORITY_FILES: readonly string[] = ["SKILL.md", "README.md"];

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function isFolder(node: FileTreeNodeData): boolean {
	return node.children !== undefined;
}

function sortLevel(nodes: readonly FileTreeNodeData[], root: boolean): FileTreeNodeData[] {
	const rank = (node: FileTreeNodeData): number => {
		if (isFolder(node)) return PRIORITY_FILES.length;
		const priority = root ? PRIORITY_FILES.indexOf(baseName(node.path)) : -1;
		return priority === -1 ? PRIORITY_FILES.length + 1 : priority;
	};
	return [...nodes]
		.sort((a, b) => rank(a) - rank(b) || baseName(a.path).localeCompare(baseName(b.path)))
		.map((node) =>
			node.children === undefined ? node : {path: node.path, children: sortLevel(node.children, false)},
		);
}

/**
 * Upstream Contents order: SKILL.md, then README.md, then folders, then the
 * other root files. Inside folders: subfolders, then files, A–Z.
 */
export function orderContentsTree(nodes: readonly FileTreeNodeData[]): FileTreeNodeData[] {
	return sortLevel(nodes, true);
}

/** The file the viewer opens first: the first file in (ordered) tree order. */
export function defaultContentsFile(nodes: readonly FileTreeNodeData[]): string | null {
	for (const node of nodes) {
		if (node.children === undefined) return node.path;
		const nested = defaultContentsFile(node.children);
		if (nested !== null) return nested;
	}
	return null;
}

export function containsFile(nodes: readonly FileTreeNodeData[], path: string): boolean {
	return nodes.some((node) => (node.children === undefined ? node.path === path : containsFile(node.children, path)));
}

export function countContentsFiles(nodes: readonly FileTreeNodeData[]): number {
	return nodes.reduce(
		(total, node) => total + (node.children === undefined ? 1 : countContentsFiles(node.children)),
		0,
	);
}

/** Markdown Preview hides the `---` fenced frontmatter block; Code keeps it. */
export function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	const afterFence = content.indexOf("\n", end + 4);
	return afterFence === -1 ? "" : content.slice(afterFence + 1).replace(/^\n+/, "");
}

export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}
