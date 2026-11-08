/**
 * Upstream's cds overlay marker (shared-frame `gT`/`T8`/`fc`): every open Menu, ContextMenu, Popover and
 * Dialog/AlertDialog popup carries `data-cds-overlay=""`, and Base UI toggles `data-open` on it. Tooltips,
 * InfoTips, Combobox/Select popups, PreviewCards, Toasts and CoachMarks stay unmarked.
 */
export const OVERLAY_ATTR = "data-cds-overlay";

export const OPEN_OVERLAY_SELECTOR = `[${OVERLAY_ATTR}][data-open]`;

/** Spread on an overlay popup element before its own props, as upstream's `{[gT]:""}`. */
export const overlayAttrs = {[OVERLAY_ATTR]: ""} as const;

const DOCUMENT_NODE = 9;

function isDocument(node: Document | Element): node is Document {
	return node.nodeType === DOCUMENT_NODE;
}

/**
 * Upstream `zI` (formerly `op`): whether an open overlay exists in `target`'s document that is neither
 * `target` nor an ancestor of it. With no target it checks `document` (false during SSR), so any open
 * overlay counts.
 */
export function isAnotherOverlayOpen(target?: Document | Element | null): boolean {
	const node = target ?? (typeof document === "undefined" ? undefined : document);
	if (node === undefined) return false;
	const doc = isDocument(node) ? node : node.ownerDocument;
	for (const element of doc.querySelectorAll(OPEN_OVERLAY_SELECTOR)) {
		if (element !== node && !element.contains(node)) return true;
	}
	return false;
}
