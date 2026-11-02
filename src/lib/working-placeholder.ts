/** Upstream's placeholder while Claude works: `{sendKey} to send, {queueKey} to queue for later`. */
export function workingPlaceholder(isMac: boolean): string {
	return `⏎ to send, ${isMac ? "⌘⏎" : "Ctrl⏎"} to queue for later`;
}

/** Upstream's `{queueKey} to queue`, shown once the full working placeholder overflows the editor. */
export function pickWorkingPlaceholder({fits, isMac}: {fits: boolean; isMac: boolean}): string {
	return fits ? workingPlaceholder(isMac) : `${isMac ? "⌘⏎" : "Ctrl⏎"} to queue`;
}

/**
 * Upstream's gate `Je` (`showStop && plainEnterSends && !disabled && !submitBlocked`): the working placeholder
 * shows only where plain Enter sends, which `m6()` limits to a fine pointer or a Windows UA. Local has no
 * history-search mode, so that clause has no analogue.
 */
export function showsWorkingPlaceholder({
	working,
	disabled,
	coarse,
	isWindows,
}: {
	working: boolean;
	disabled: boolean;
	coarse: boolean;
	isWindows: boolean;
}): boolean {
	return working && !disabled && (!coarse || isWindows);
}
