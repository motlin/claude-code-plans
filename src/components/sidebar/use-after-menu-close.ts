import {useRef} from "react";

/**
 * Defers a menu item's action until its menu has closed, and keeps the menu from handing focus
 * back to its trigger, for actions that move focus themselves (the home composer, a confirm).
 * Spread `menuProps` on the menu root and `contentProps` on its MenuContent.
 */
export function useAfterMenuClose() {
	const afterClose = useRef<(() => void) | null>(null);
	// Menus hand focus back after onOpenChangeComplete, so this outlives the queued action.
	const keepFocus = useRef(false);
	return {
		later: (action: () => void) => () => {
			afterClose.current = action;
			keepFocus.current = true;
		},
		menuProps: {
			onOpenChangeComplete: (open: boolean) => {
				if (open) {
					keepFocus.current = false;
					return;
				}
				const action = afterClose.current;
				afterClose.current = null;
				action?.();
			},
		},
		contentProps: {finalFocus: () => !keepFocus.current},
	};
}
