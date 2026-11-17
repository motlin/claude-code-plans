import {useContext, useSyncExternalStore, type ReactNode} from "react";
import {createPortal} from "react-dom";

import {TailActionsOutletContext, TranscriptLastRowContext} from "./tail-actions-context";

const noSubscribe = () => () => undefined;
const noElement = () => null;

/**
 * Upstream's tail-actions `elementFor`: the last row's message actions portal into `transcript-tail-actions`, below the
 * turn box, while that outlet exists; otherwise they render in place.
 */
export function TailActionsPortal({children}: {children: ReactNode}): ReactNode
{
	const outlet = useContext(TailActionsOutletContext);
	const last = useContext(TranscriptLastRowContext);
	const element = useSyncExternalStore(outlet?.subscribe ?? noSubscribe, outlet?.get ?? noElement, noElement);
	return last && element !== null ? createPortal(children, element) : children;
}
