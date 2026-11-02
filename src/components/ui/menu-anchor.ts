import type {RefObject} from "react";

/**
 * cds' `ua()`: a submenu anchors to the parent popup's horizontal span at the
 * trigger row's height, so `sideOffset` measures from the popup edge, not the
 * row (the default 2 lands 6px past the row; Copy ▸'s -4 sits on the row edge).
 */
export function submenuAnchor(triggerRef: RefObject<HTMLElement | null>)
{
	return {
		get contextElement()
		{
			return triggerRef.current ?? undefined;
		},
		getBoundingClientRect: () =>
		{
			const trigger = triggerRef.current?.getBoundingClientRect();
			const popup = triggerRef.current?.closest('[role="menu"]')?.getBoundingClientRect();
			const x = popup?.x ?? trigger?.x ?? 0;
			const y = trigger?.y ?? 0;
			const width = popup?.width ?? trigger?.width ?? 0;
			const height = trigger?.height ?? 0;
			return {
				x,
				y,
				width,
				height,
				top: y,
				left: x,
				right: x + width,
				bottom: y + height,
			};
		},
	};
}

/** cds resolves a submenu's logical inline-end side against the document direction. */
export function inlineEndSide(): "left" | "right"
{
	return document.documentElement.dir === "rtl" ? "left" : "right";
}
