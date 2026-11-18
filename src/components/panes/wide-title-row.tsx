import {useContext, useLayoutEffect, type CSSProperties, type DragEvent, type ReactNode} from "react";
import {createPortal} from "react-dom";

import {WideTitleRowContext} from "./wide-title-row-context";

const SPACER_STYLE =
{
	height: "var(--wide-title-row-h)",
} as const satisfies CSSProperties;

/** Upstream shared-20 `Xb`: a drag over the lifted header is refused, so it never reaches the chat's drop zone. */
function refuseDrag(event: DragEvent<HTMLDivElement>)
{
	event.stopPropagation();
	event.preventDefault();
	event.dataTransfer.dropEffect = "none";
}

/**
 * Upstream shared-20 `xk` → `Fp`: inside the wide title row's slot the session header portals into the row (reporting
 * the lift so the tile host pads the top panes) and, when the chat is on the top edge, leaves a spacer of the row's
 * height in its place. The desktop lifted-header changes don't apply (upstream calls `children(false)`). Outside a slot
 * the header renders in place; in the row it sits in `rowClassName`, which stands in for the chat header's own insets.
 */
export function LiftedHeader({children, rowClassName}: {children: ReactNode; rowClassName?: string}): ReactNode
{
	const slot = useContext(WideTitleRowContext);
	const el = slot?.el ?? null;
	const onRowLifted = slot?.onRowLifted;
	useLayoutEffect(() =>
	{
		if (el === null || onRowLifted === undefined) return undefined;
		onRowLifted(true);
		return () =>
		{
			onRowLifted(false);
		};
	}, [el, onRowLifted]);
	if (slot === null) return children;
	// Until the row element commits (the same layout pass), the header waits rather than mounting in place twice.
	return (
		<>
			{slot.overChat && <div data-wide-title-row-spacer="" className="shrink-0" style={SPACER_STYLE} />}
			{el !== null &&
				createPortal(
					<div
						className="contents"
						onDragEnter={refuseDrag}
						onDragOver={refuseDrag}
						onDragLeave={refuseDrag}
						onDrop={refuseDrag}
					>
						{rowClassName === undefined ? children : <div className={rowClassName}>{children}</div>}
					</div>,
					el,
				)}
		</>
	);
}
