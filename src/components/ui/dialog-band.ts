import {useCallback, useRef} from "react";

import {useFizzyLake} from "../../lib/fizzy-lake";

export const GHOST_ICON_BUTTON =
	"flex shrink-0 items-center justify-center text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/*
 * Upstream `JK` (the panels dialog body): the band's scroll timeline, `scroll-fade-hide-top` under a
 * band, and `scroll-pt` = h-control + 3 × toolbar-pad-block (52 fine / 56 coarse), in a tall window only.
 */
export const DIALOG_BAND_BODY_CLASS =
	"[scroll-timeline:--sc-dialog-scroll_block] [:where([data-cds-tall-window])_&]:has-[[data-cds-part=band]]:scroll-fade-hide-top [:where([data-cds-tall-window])_&]:scroll-pt-[56px] panels-fine:[:where([data-cds-tall-window])_&]:scroll-pt-[52px]";

/** `DIALOG_BAND_BODY_CLASS` while panels renders the band, else nothing (upstream `Xn` alone). */
export function useDialogBandBodyClass(): string {
	return useFizzyLake("panels") ? DIALOG_BAND_BODY_CLASS : "";
}

const TALL_WINDOW_QUERY = "(min-height: 30rem)";

/** Upstream `An()`: `data-cds-tall-window` on the popup while the viewport is at least 30rem tall. */
export function useTallWindowRef(): (element: HTMLElement | null) => void {
	const cleanupRef = useRef<(() => void) | null>(null);
	return useCallback((element: HTMLElement | null) => {
		cleanupRef.current?.();
		cleanupRef.current = null;
		if (element === null || typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(TALL_WINDOW_QUERY);
		const sync = () => {
			element.toggleAttribute("data-cds-tall-window", media.matches);
		};
		sync();
		media.addEventListener("change", sync);
		cleanupRef.current = () => {
			media.removeEventListener("change", sync);
		};
	}, []);
}
