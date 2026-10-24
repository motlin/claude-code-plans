/**
 * Write text (and, when given, its HTML rendering) to the clipboard with a legacy fallback for non-secure contexts.
 *
 * The modern `navigator.clipboard.writeText()` API requires a secure context
 * (HTTPS or localhost). When the app is served over plain HTTP on a LAN address,
 * this function falls back to the deprecated `document.execCommand('copy')` via
 * a temporary textarea element.
 *
 * Returns true if the copy succeeded, false otherwise.
 */
export async function writeClipboardText(text: string, html?: string): Promise<boolean> {
	// With html, write both flavours as one item so rich editors keep the formatting, as upstream's Copy does.
	if (html !== undefined) {
		try {
			const item = new ClipboardItem({
				"text/plain": new Blob([text], {type: "text/plain"}),
				"text/html": new Blob([html], {type: "text/html"}),
			});
			await navigator.clipboard.write([item]);
			return true;
		} catch {
			// Fall through to plain text
		}
	}

	// Try the modern Clipboard API first; outside a secure context navigator.clipboard is
	// undefined despite its type, and the TypeError lands in the same fallback.
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Fall through to legacy approach
	}

	// Legacy fallback using execCommand
	try {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		// Position off-screen to avoid visual flash
		textarea.style.position = "fixed";
		textarea.style.left = "-9999px";
		textarea.style.top = "-9999px";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		// oxlint-disable-next-line typescript/no-deprecated -- no replacement: the Clipboard API is unavailable outside secure contexts, which this fallback exists for
		const success = document.execCommand("copy");
		document.body.removeChild(textarea);
		return success;
	} catch {
		return false;
	}
}
