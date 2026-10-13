import {useRef} from "react";

/**
 * The open menu holds focus, so the rename input may only mount (and take
 * focus) once the menu has closed; the closing menu must not hand focus back.
 * Base UI may ask for the final focus only after the close completed and the
 * input took focus, so the no-return flag lasts until the menu next opens.
 */
export function useRenameAfterMenuClose(startEditing: () => void) {
	const renameAfterClose = useRef(false);
	const keepFocus = useRef(false);
	return {
		requestRename: () => {
			renameAfterClose.current = true;
			keepFocus.current = true;
		},
		onOpenChangeComplete: (open: boolean) => {
			if (open) {
				keepFocus.current = false;
				return;
			}
			if (!renameAfterClose.current) return;
			renameAfterClose.current = false;
			startEditing();
		},
		finalFocus: () => !keepFocus.current,
	};
}
