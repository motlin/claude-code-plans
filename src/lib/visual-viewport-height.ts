// Mirrors upstream's "app-keyboard-fit": while a touch device's soft keyboard
// shrinks the visual viewport, pin the app frame to the visible height so the
// titlebar and composer stay on screen instead of iOS scrolling the document.
export const APP_VISUAL_VIEWPORT_HEIGHT_VAR = "--app-visual-viewport-height";

export interface VisualViewportHost {
	readonly innerHeight: number;
	// Optional: jsdom and older browsers have no visualViewport at all.
	readonly visualViewport?: (EventTarget & {readonly height: number}) | null;
	matchMedia(query: string): {readonly matches: boolean};
	readonly document: Document;
}

export function installVisualViewportHeight(host: VisualViewportHost = window): () => void {
	const viewport = host.visualViewport;
	if (viewport === undefined || viewport === null) return () => {};
	const style = host.document.documentElement.style;

	const update = () => {
		const keyboardOpen = host.matchMedia("(pointer: coarse)").matches && viewport.height < host.innerHeight - 1;
		if (keyboardOpen) {
			style.setProperty(APP_VISUAL_VIEWPORT_HEIGHT_VAR, `${viewport.height}px`);
		} else {
			style.removeProperty(APP_VISUAL_VIEWPORT_HEIGHT_VAR);
		}
	};

	viewport.addEventListener("resize", update);
	viewport.addEventListener("scroll", update);
	update();
	return () => {
		viewport.removeEventListener("resize", update);
		viewport.removeEventListener("scroll", update);
		style.removeProperty(APP_VISUAL_VIEWPORT_HEIGHT_VAR);
	};
}
