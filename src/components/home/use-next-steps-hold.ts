import {useRef, useState, type FocusEvent} from "react";

interface Hold {
	keys: ReadonlySet<string>;
	pointer: boolean;
	/** The `data-row-key` of the focused row, or null when focus is outside the list. */
	focus: string | null;
}

/**
 * Upstream's Next steps hold (`wie`): while the pointer is over the list or focus is inside it, the candidate keys
 * present when the hold began are frozen, so a newly arrived candidate can't shift rows under the pointer; removals
 * still apply. The hold lasts while `pinned` (a rest popup is open), and releases otherwise once both the pointer and
 * focus have left.
 */
export function useNextStepsHold({keys, pinned}: Readonly<{keys: readonly string[]; pinned: boolean}>) {
	const groupRef = useRef<HTMLUListElement>(null);
	const [hold, setHold] = useState<Hold | null>(null);
	if (hold !== null && !hold.pointer && hold.focus === null && !pinned) setHold(null);

	const start = (patch: Partial<Hold>) => {
		setHold((previous) => ({...(previous ?? {keys: new Set(keys), pointer: false, focus: null}), ...patch}));
	};
	const update = (patch: Partial<Hold>) => {
		setHold((previous) => previous && {...previous, ...patch});
	};

	return {
		held: hold?.keys ?? null,
		focus: hold?.focus ?? null,
		dropFocus: () => {
			update({focus: null});
		},
		/** After a popup closes: whether the pointer is still over the list. */
		recheckPointer: () => {
			update({pointer: groupRef.current?.matches(":hover") ?? false});
		},
		groupRef,
		groupProps: {
			onPointerEnter: () => {
				start({pointer: true});
			},
			onPointerLeave: () => {
				update({pointer: false});
			},
			onFocus: (event: FocusEvent<HTMLElement>) => {
				start({focus: event.target.closest("li")?.getAttribute("data-row-key") ?? null});
			},
			onBlur: (event: FocusEvent<HTMLElement>) => {
				if (!event.currentTarget.contains(event.relatedTarget)) update({focus: null});
			},
		},
	};
}
