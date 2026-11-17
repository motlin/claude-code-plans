import {elementOffscreen} from "./dock-keys";

interface ScrollMark
{
	element: Element;
	top: number;
	left: number;
}

function hasMoveBefore(slot: Element): slot is Element &
{
	moveBefore: (node: Node, child: Node | null) => void;
}
{
	return "moveBefore" in slot && typeof slot.moveBefore === "function";
}

/**
 * Upstream's host move (`Sx`, fallback `bm`): `moveBefore` keeps focus and scroll positions as is; without it (or
 * when it throws), the host is appended and every descendant's scroll offsets and a focused element still on
 * screen are restored.
 */
export function moveApprovalHost(host: HTMLElement, slot: HTMLElement): void
{
	if (hasMoveBefore(slot) && host.isConnected)
	{
		try
		{
			slot.moveBefore(host, null);
			return;
		}
		catch
		{
			// Falls through to the append below.
		}
	}
	const doc = host.ownerDocument;
	const active = doc.activeElement;
	const focused = active instanceof HTMLElement && host.contains(active) ? active : null;
	const scrolls: ScrollMark[] = [];
	for (const element of host.querySelectorAll("*"))
	{
		if (element.scrollTop !== 0 || element.scrollLeft !== 0)
		{
			scrolls.push(
				{
					element,
					top: element.scrollTop,
					left: element.scrollLeft,
				},
			);
		}
	}
	slot.appendChild(host);
	for (const {element, top, left} of scrolls)
	{
		element.scrollTop = top;
		element.scrollLeft = left;
	}
	if (focused !== null && doc.activeElement !== focused && !elementOffscreen(focused))
	{
		focused.focus(
			{
				preventScroll: true,
			},
		);
	}
}
