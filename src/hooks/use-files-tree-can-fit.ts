import {type RefObject, useLayoutEffect, useRef, useState} from "react";

import {FILES_TREE_FIT_MIN_WIDTH} from "../components/files/files-tree-layout";

/**
 * Upstream's `filesTreeCanFit` (c9bd7af9c `Wk`): whether the Files pane body is at least 400px wide, room for the
 * tree beside a file. It measures `clientWidth` on mount, then follows a ResizeObserver; a width of 0 (a
 * `display:none` pane) keeps the last value. `onFirstMeasure` runs once, on the first nonzero width, with its fit,
 * where upstream replays a reveal or filter focus that assumed the pane fit.
 */
export function useFilesTreeCanFit(
	ref: RefObject<HTMLElement | null>,
	onFirstMeasure?: (canFit: boolean) => void,
): boolean
{
	const [canFit, setCanFit] = useState(true);
	const firstMeasureRef = useRef(onFirstMeasure);
	useLayoutEffect(() =>
	{
		firstMeasureRef.current = onFirstMeasure;
	});
	useLayoutEffect(() =>
	{
		const body = ref.current;
		if (body === null) return undefined;
		let measured = false;
		const update = (width: number): void =>
		{
			if (width <= 0) return;
			const fits = width >= FILES_TREE_FIT_MIN_WIDTH;
			setCanFit(fits);
			if (measured) return;
			measured = true;
			firstMeasureRef.current?.(fits);
		};
		update(body.clientWidth);
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver((entries) =>
		{
			const entry = entries[0];
			if (entry !== undefined) update(entry.contentRect.width);
		});
		observer.observe(body);
		return () =>
		{
			observer.disconnect();
		};
	}, [ref]);
	return canFit;
}
