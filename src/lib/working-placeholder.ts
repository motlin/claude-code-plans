/**
 * Upstream's working hint while Claude works: the compact FIL0bW `{queueKey} to queue`, shown (and probed) at every
 * width, and the spoken mZ6xnU `{sendKey} to send, {queueKey} to queue for later` the editor carries as
 * `aria-description`. Upstream's `fd` writes Mac keys as glyphs and spells them out, joined with
 * `+`, everywhere else (`⏎` reads "Enter"; `Ctrl` has no glyph).
 */
export function workingPlaceholders(isMac: boolean):
{
	compact: string;
	spoken: string;
}
{
	const queue = isMac ? "⌘⏎" : "Ctrl+Enter";
	return {
		compact: `${queue} to queue`,
		spoken: `Enter to send, ${isMac ? "Command+Enter" : "Ctrl+Enter"} to queue for later`,
	};
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
}): boolean
{
	return working && !disabled && (!coarse || isWindows);
}
