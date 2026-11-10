import type {HerdrTerminalPaneData, HerdrTerminalWorkspaceData} from "../api/herdr-terminals";

type HerdrTerminalTabData = HerdrTerminalWorkspaceData["tabs"][number];

/** How a tab reads in labels: "Tab 2 shells". */
export function tabName(tab: HerdrTerminalTabData): string {
	return `Tab ${tab.number} ${tab.label}`;
}

export interface FoundTerminalPane {
	tab: HerdrTerminalTabData;
	pane: HerdrTerminalPaneData;
	/** The pane's position among its tab's panes. */
	index: number;
}

/** A pane's tab and position in herdr's terminal list; null while the list is unloaded or lacks the pane. */
export function findTerminalPane(
	workspaces: readonly HerdrTerminalWorkspaceData[] | undefined,
	paneId: string,
): FoundTerminalPane | null {
	for (const tab of workspaces?.flatMap((workspace) => workspace.tabs) ?? []) {
		const index = tab.panes.findIndex((pane) => pane.paneId === paneId);
		const pane = tab.panes[index];
		if (pane !== undefined) return {tab, pane, index};
	}
	return null;
}

/** The pane `step` places after `paneId` in its tab, wrapping around; null when the tab has no other pane. */
export function siblingPaneId(tab: HerdrTerminalTabData, paneId: string, step: 1 | -1): string | null {
	const count = tab.panes.length;
	const index = tab.panes.findIndex((pane) => pane.paneId === paneId);
	if (index === -1 || count < 2) return null;
	return tab.panes[(index + step + count) % count]?.paneId ?? null;
}

/** Where the view goes once `paneId` closes: the next pane in its tab, else the previous, else nowhere. */
export function paneAfterClose(tab: HerdrTerminalTabData, paneId: string): string | null {
	const index = tab.panes.findIndex((pane) => pane.paneId === paneId);
	if (index === -1) return null;
	return (tab.panes[index + 1] ?? tab.panes[index - 1])?.paneId ?? null;
}

/** Closing kills whatever holds the foreground, so a still-running process asks first. */
export function closeNeedsConfirmation(panes: readonly HerdrTerminalPaneData[]): boolean {
	return panes.some((pane) => pane.process === "running");
}
