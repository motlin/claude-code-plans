import {type MouseEvent as ReactMouseEvent, useCallback, useState} from "react";

/**
 * Upstream `Ai`/`ka`: a menu button whose right-click opens its own dropdown, anchored to the trigger like a
 * click (a `Menu`, not a `ContextMenu` at the pointer). Spread `rootProps` on the `Menu` and pass `onContextMenu`
 * to the trigger (or the row that owns it).
 */
export function useMenuOpensOnContextMenu(): {
	rootProps: {open: boolean; onOpenChange: (open: boolean) => void};
	onContextMenu: (event: ReactMouseEvent) => void;
} {
	const [open, setOpen] = useState(false);
	const onContextMenu = useCallback((event: ReactMouseEvent) => {
		event.preventDefault();
		setOpen(true);
	}, []);
	return {rootProps: {open, onOpenChange: setOpen}, onContextMenu};
}
