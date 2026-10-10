/**
 * Set by ⇧⌘F when it opens the Files pane, consumed by the pane's filter input on
 * mount: upstream focuses the filter only when the shortcut opened the pane.
 */
let pendingFilterFocus = false;

export function setPendingFilterFocus(pending: boolean): void {
	pendingFilterFocus = pending;
}

export function consumePendingFilterFocus(): boolean {
	const pending = pendingFilterFocus;
	pendingFilterFocus = false;
	return pending;
}
