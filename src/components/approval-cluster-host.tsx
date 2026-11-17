import {useContext, useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {createPortal} from "react-dom";

import {moveApprovalHost} from "../lib/approval-host-move";
import {ApprovalDockContext} from "./approval-dock-context";

/**
 * Upstream's approval cluster host (`BH`/`OP`): the cards render once, portaled into a stable
 * `[data-approval-cluster-host]`, which is moved between this inline slot and the composer's dock slot as the
 * presentation changes, so drafts, focus and scroll survive the switch with no remount. Outside a session dock
 * it stays in the inline slot.
 */
export function ApprovalClusterHost({children}: {children: ReactNode})
{
	const dock = useContext(ApprovalDockContext);
	const inlineRef = useRef<HTMLDivElement>(null);
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const dockSlot = dock?.presentation === "dock" ? dock.dockSlot : null;
	useLayoutEffect(() =>
	{
		const inline = inlineRef.current;
		if (inline === null) return undefined;
		const element = inline.ownerDocument.createElement("div");
		element.setAttribute("data-approval-cluster-host", "");
		element.style.display = "contents";
		inline.appendChild(element);
		setHost(element);
		return () =>
		{
			element.remove();
		};
	}, []);
	useLayoutEffect(() =>
	{
		const target = dockSlot ?? inlineRef.current;
		if (host === null || target === null || host.parentNode === target) return;
		moveApprovalHost(host, target);
	}, [host, dockSlot]);
	return (
		<>
			<div ref={inlineRef} data-inline-approval-slot="" className="contents" />
			{host !== null && createPortal(children, host)}
		</>
	);
}
