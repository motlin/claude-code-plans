import {useSyncExternalStore, type ReactNode} from "react";
import {createPortal} from "react-dom";

function subscribeNever(): () => void {
	return () => {};
}

/**
 * Renders `position: fixed` UI into `document.body`. The transcript scroller
 * carries `contain: strict`, which makes it the containing block for fixed
 * descendants, so anything fixed rendered inside it scrolls away with the
 * transcript instead of staying pinned to the viewport.
 *
 * Renders nothing during SSR and hydration, then portals on the client.
 */
export function ViewportPortal({children}: {children: ReactNode}) {
	const isClient = useSyncExternalStore(
		subscribeNever,
		() => true,
		() => false,
	);
	if (!isClient) return null;
	return createPortal(children, document.body);
}
