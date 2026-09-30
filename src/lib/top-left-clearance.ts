import type {CSSProperties} from "react";

/**
 * Space the main pane's top-left corner leaves for the floating 24x24 "Show sidebar" toggle at
 * 12,12 while the desktop sidebar is collapsed, as on claude.ai/code: the titlebar row starts at
 * x=41 and its 32px row starts at y=9 so its centre lines up with the toggle's.
 */
export function topLeftClearance(sidebarCollapsed: boolean): {start: number; top: number} | null {
	return sidebarCollapsed ? {start: 41, top: 9} : null;
}

/** The clearance as CSS vars for <main>; sticky titlebars read them with a 0px fallback. */
export function topLeftClearanceStyle(sidebarCollapsed: boolean): CSSProperties | undefined {
	const clearance = topLeftClearance(sidebarCollapsed);
	if (!clearance) return undefined;
	return {
		"--top-left-clearance-start": `${clearance.start}px`,
		"--top-left-clearance-top": `${clearance.top}px`,
	} as CSSProperties;
}
