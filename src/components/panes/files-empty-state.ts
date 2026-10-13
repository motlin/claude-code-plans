export interface FilesEmptyState {
	title: string;
	detail: string;
}

/** Upstream's three viewer empty states, chosen by whether the tree shows and how many tabs are open. */
export function filesEmptyState(hasTree: boolean, tabCount: number): FilesEmptyState {
	if (tabCount > 0) {
		return {
			title: "No file selected",
			detail: "Pick an open file above, or click a file path in the conversation.",
		};
	}
	return {
		title: "Open files appear here",
		detail: hasTree
			? "Pick a file in the tree, or click a file path in the conversation."
			: "Click a file path in the conversation to open it.",
	};
}
