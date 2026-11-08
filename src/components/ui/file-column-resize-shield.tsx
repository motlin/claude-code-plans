import {createPortal} from "react-dom";

/**
 * Upstream's c44d00c7f `Ni`: while a file column resizes, a fixed veil over the whole page keeps the
 * col-resize cursor everywhere and stops iframes and editors from eating the pointer moves. Upstream
 * takes its z-index from the frame layer helper; 50 sits above the panes and below menus.
 */
export function FileColumnResizeShield({active}: {active: boolean}) {
	if (!active || typeof document === "undefined") return null;
	return createPortal(
		<div
			aria-hidden="true"
			data-file-tree-resize-shield=""
			className="fixed inset-0 cursor-col-resize bg-alpha-1 opacity-20"
			style={{zIndex: 50}}
		/>,
		document.body,
	);
}
