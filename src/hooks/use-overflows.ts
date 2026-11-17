import {type RefObject, useEffect, useLayoutEffect, useState} from "react";

const overflowing = (element: HTMLElement): boolean => element.scrollHeight > element.clientHeight;

/**
 * Upstream's overflow hook (cf0704cb0): whether `ref`'s content runs past its box on the y axis. It measures after
 * every render that changes `children`, once more after `document.fonts.ready`, whenever the element or any element
 * child resizes, and whenever a child comes or goes (its new children are observed, removed ones unobserved).
 */
export function useOverflows(ref: RefObject<HTMLElement | null>, children: unknown): boolean
{
	const [overflows, setOverflows] = useState(false);
	useLayoutEffect(() =>
	{
		const element = ref.current;
		if (element !== null) setOverflows(overflowing(element));
	}, [ref, children]);
	useEffect(() =>
	{
		const element = ref.current;
		if (element === null) return undefined;
		let live = true;
		const measure = () =>
		{
			if (live) setOverflows(overflowing(element));
		};
		const fonts = element.ownerDocument.fonts as FontFaceSet | undefined;
		fonts?.ready.then(measure).catch(() => {});
		const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		resize?.observe(element);
		for (const child of element.children) resize?.observe(child);
		const mutation =
			typeof MutationObserver === "undefined"
				? null
				: new MutationObserver((records) =>
					{
						for (const record of records)
						{
							for (const node of record.addedNodes) if (node instanceof Element) resize?.observe(node);
							for (const node of record.removedNodes)
								if (node instanceof Element) resize?.unobserve(node);
						}
						measure();
					});
		mutation?.observe(
			element,
			{
				childList: true,
			},
		);
		return () =>
		{
			live = false;
			resize?.disconnect();
			mutation?.disconnect();
		};
	}, [ref]);
	return overflows;
}
