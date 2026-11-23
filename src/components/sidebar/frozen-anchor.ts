/**
 * Upstream `IC`: the trigger's rect measured once at open, so the popup stays put while the list regroups under it,
 * stretched to the sidebar body's inline-end edge so a side-opening popup clears the sidebar.
 */
export interface FrozenAnchor
{
	contextElement: Element;
	getBoundingClientRect: () => DOMRect;
}

/** Upstream `LZ`: the trigger's rect widened to whichever edge of the enclosing sidebar body it faces. */
function stretchToSidebarBody(trigger: Element): DOMRect
{
	const rect = trigger.getBoundingClientRect();
	const body = trigger.closest("[data-sidebar-body]")?.getBoundingClientRect();
	if (body === undefined) return rect;
	const [left, right] = rect.x + rect.right > body.x + body.right ? [rect.x, body.right] : [body.x, rect.right];
	return new DOMRect(left, rect.y, right - left, rect.height);
}

export function freezeAnchor(trigger: Element): FrozenAnchor
{
	const rect = stretchToSidebarBody(trigger);
	return {
		contextElement: trigger,
		getBoundingClientRect: () => rect,
	};
}
