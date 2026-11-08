import {type RefObject, useLayoutEffect, useReducer, useRef} from "react";

/**
 * Upstream's `$2` (shared-80; inlined in the turn status `TC`): when a root-level status collapses while focus is
 * inside its own panel (the root's first `[data-cds-row-panel]`), focus moves to its first `[data-cds-row-toggle]`
 * with `preventScroll`, before the panel leaves the DOM.
 *
 * Upstream's Base UI panel outlives the closing commit; local bodies unmount, so `panelMounted` stays true for the
 * one render in which `open` went false. Render the panel while `panelMounted` (with `hidden` while `!open`); the
 * layout effect then drops it in the next commit.
 */
export function useStepCollapseFocusReturn(open: boolean): {
	rootRef: RefObject<HTMLDivElement | null>;
	panelMounted: boolean;
} {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const wasOpen = useRef(open);
	const [, rerender] = useReducer((tick: number) => tick + 1, 0);
	const closing = wasOpen.current && !open;

	useLayoutEffect(() => {
		const latched = wasOpen.current;
		wasOpen.current = open;
		if (open) return;
		const n = rootRef.current;
		const active = n?.ownerDocument.activeElement ?? null;
		if (n && active !== null && n.querySelector("[data-cds-row-panel]")?.contains(active))
			n.querySelector<HTMLElement>("[data-cds-row-toggle]")?.focus({preventScroll: true});
		if (latched) rerender();
	}, [open]);

	return {rootRef, panelMounted: open || closing};
}
