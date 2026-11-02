import {useSyncExternalStore, type ReactNode} from "react";
import {createPortal} from "react-dom";

import {DensityScope} from "./ui/density";
import {useDensity} from "./ui/density-context";

function subscribeNever(): () => void
{
	return () =>
	{
	};
}

/**
 * Renders `position: fixed` UI into `document.body`. The transcript scroller
 * carries `contain: strict`, which makes it the containing block for fixed
 * descendants, so anything fixed rendered inside it scrolls away with the
 * transcript instead of staying pinned to the viewport.
 *
 * Renders nothing during SSR and hydration, then portals on the client, inside
 * a `display: contents` wrapper marked `data-cds-portal` and carrying the
 * opener's density, as upstream's cds Portal wrapper copies `data-density`.
 */
export function ViewportPortal({children}: {children: ReactNode})
{
	const isClient = useSyncExternalStore(
		subscribeNever,
		() => true,
		() => false,
	);
	const density = useDensity();
	if (!isClient) return null;
	return createPortal(
		<DensityScope portal density={density}>
			{children}
		</DensityScope>,
		document.body,
	);
}
