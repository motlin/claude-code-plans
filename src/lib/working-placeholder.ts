/**
 * Upstream's working hint while Claude works (mZ6xnU `{sendKey} to send, {queueKey} to queue for later`), its compact
 * form shown once the full one overflows the editor (FIL0bW `{queueKey} to queue`), and the spoken full text the
 * editor carries as `aria-description`. Upstream's `fd` writes Mac keys as glyphs and spells them out, joined with
 * `+`, everywhere else (`⏎` reads "Enter"; `Ctrl` has no glyph).
 */
export function workingPlaceholders(isMac: boolean):
{
	full: string;
	compact: string;
	spoken: string;
}
{
	const send = isMac ? "⏎" : "Enter";
	const queue = isMac ? "⌘⏎" : "Ctrl+Enter";
	return {
		full: `${send} to send, ${queue} to queue for later`,
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
