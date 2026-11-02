import {useCallback} from "react";

function isHeightTransition(animation: Animation): boolean
{
	return "transitionProperty" in animation && animation.transitionProperty === "height";
}

/** Upstream `lp`: keep `data-animating` on the panel while it enters, leaves, or runs a height transition. */
function trackAnimating(element: HTMLElement): () => void
{
	const update = () =>
	{
		const animating =
			element.hasAttribute("data-starting-style") ||
			element.hasAttribute("data-ending-style") ||
			("getAnimations" in element && element.getAnimations().some(isHeightTransition));
		element.toggleAttribute("data-animating", animating);
	};
	const observer = new (element.ownerDocument.defaultView?.MutationObserver ?? MutationObserver)(update);
	observer.observe(
		element,
		{
			attributeFilter: ["data-starting-style", "data-ending-style"],
		},
	);
	update();
	const isHeightEvent = (event: Event) =>
		event.target === element && "propertyName" in event && event.propertyName === "height";
	const onRun = (event: Event) =>
	{
		if (isHeightEvent(event)) element.setAttribute("data-animating", "");
	};
	const onEnd = (event: Event) =>
	{
		if (isHeightEvent(event)) update();
	};
	element.addEventListener("transitionrun", onRun);
	element.addEventListener("transitionend", onEnd);
	element.addEventListener("transitioncancel", onEnd);
	return () =>
	{
		observer.disconnect();
		element.removeEventListener("transitionrun", onRun);
		element.removeEventListener("transitionend", onEnd);
		element.removeEventListener("transitioncancel", onEnd);
		element.removeAttribute("data-animating");
	};
}

/** Upstream `D$`: a callback ref that installs `trackAnimating` on the attached element and tears it down on detach. */
export function useAnimatingAttr(): (element: HTMLElement | null) => (() => void) | undefined
{
	return useCallback((element: HTMLElement | null) => (element === null ? undefined : trackAnimating(element)), []);
}
