/**
 * Key logic for the ⌃Q recents switcher, copied from claude.ai/code's HistorySwitcher: Ctrl+Q
 * (Alt+Q on Windows) with strict modifiers, ⇧ to reverse except where the OS owns Ctrl+Shift+Q.
 */
export type SwitcherPlatform = "mac" | "windows" | "linux" | "chromeos";

/** +1 walks back through history, −1 walks forward from the oldest entry. */
export type SwitchDirection = 1 | -1;

type SwitchKeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">;

export function platformFromUserAgent(userAgent: string): SwitcherPlatform {
	if (/mac|iphone|ipad|ipod/i.test(userAgent)) return "mac";
	if (/windows/i.test(userAgent)) return "windows";
	if (/\bCrOS\b/.test(userAgent)) return "chromeos";
	return "linux";
}

export function currentSwitcherPlatform(): SwitcherPlatform {
	return typeof navigator === "undefined" ? "linux" : platformFromUserAgent(navigator.userAgent);
}

/** Alt on Windows, Control everywhere else. */
export function switchModifier(platform: SwitcherPlatform): "Alt" | "Control" {
	return platform === "windows" ? "Alt" : "Control";
}

function isQ(event: SwitchKeyEvent): boolean {
	const key = event.key.toLowerCase();
	// Latin layouts match by key; any other layout falls back to the physical Q key.
	return /^[a-z]$/.test(key) ? key === "q" : event.code === "KeyQ";
}

export function isSwitchTrigger(event: SwitchKeyEvent, platform: SwitcherPlatform): boolean {
	if (!isQ(event) || event.metaKey) return false;
	if (platform === "windows") return event.altKey && !event.ctrlKey && !event.shiftKey;
	if (!event.ctrlKey || event.altKey) return false;
	return !(event.shiftKey && platform === "chromeos");
}

/** The previous page when the current page leads the list, else the newest; ⇧ starts oldest. */
export function initialIndex(
	entries: readonly {key: string}[],
	currentKey: string | null,
	direction: SwitchDirection,
): number {
	if (direction === -1) return Math.max(entries.length - 1, 0);
	return entries.length > 1 && entries[0]?.key === currentKey ? 1 : 0;
}

export function step(index: number, direction: SwitchDirection, count: number): number {
	return (index + direction + count) % count;
}
