import {type RefCallback, useCallback, useRef} from "react";

import {DISABLED_REASON_WRAPPER_ATTR} from "../lib/file-refs";

/**
 * Upstream's file-link focus slot (`or()` in c856385e2): one callback ref shared by a file link and the hidden
 * focus-slot span of the `missing` wrapper that replaces it. When the link unmounts while focused, and the slot
 * mounts with focus fallen to `<body>`, focus moves (without scrolling) to the slot's disabled-reason wrapper.
 */
export function useFocusSlot(): RefCallback<HTMLElement> {
	const last = useRef<HTMLElement | null>(null);
	const lostFocus = useRef(false);
	return useCallback((node: HTMLElement | null) => {
		const previous = node ?? last.current;
		last.current = node;
		const target =
			previous?.hidden === true ? previous.closest<HTMLElement>(`[${DISABLED_REASON_WRAPPER_ATTR}]`) : previous;
		if (target === null) return;
		const active = target.ownerDocument.activeElement;
		if (node === null && active === target) {
			lostFocus.current = true;
			queueMicrotask(() => {
				lostFocus.current = false;
			});
		} else if (node !== null && lostFocus.current && (active === null || active === target.ownerDocument.body)) {
			lostFocus.current = false;
			target.focus({preventScroll: true});
		}
	}, []);
}
