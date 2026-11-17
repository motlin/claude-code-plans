export interface FilesEmptyState
{
	title: string;
	detail: string;
}

export interface FilesEmptyContext
{
	/** The pane belongs to a session, so a file path in the conversation can open a file. */
	inSession: boolean;
	/** The pane has a tree the toggle could show. */
	treeAvailable: boolean;
}

/** Upstream's viewer empty state (c9bd7af9c `dd` in `Wk`), chosen by whether the tree shows, the tab count and the context. */
export function filesEmptyState(hasTree: boolean, tabCount: number, context: FilesEmptyContext): FilesEmptyState
{
	if (tabCount > 0)
	{
		return {
			title: "No file selected",
			detail: context.inSession
				? "Pick an open file above, or click a file path in the conversation."
				: "Pick one of the open files.",
		};
	}
	return {
		title: "Open files appear here",
		detail: emptyDetail(hasTree, context),
	};
}

function emptyDetail(hasTree: boolean, {inSession, treeAvailable}: FilesEmptyContext): string
{
	if (hasTree)
		return inSession
			? "Pick a file in the tree, or click a file path in the conversation."
			: "Pick a file in the tree.";
	if (inSession) return "Click a file path in the conversation to open it.";
	return treeAvailable ? "Show the file tree to pick a file." : "";
}
