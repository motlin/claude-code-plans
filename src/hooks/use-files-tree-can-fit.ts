import {type RefObject, useLayoutEffect, useState} from "react";

import {FILES_TREE_FIT_MIN_WIDTH} from "../components/files/files-tree-layout";

/**
 * Upstream's `filesTreeCanFit` (c9bd7af9c `Wk`): whether the Files pane body is at least 400px wide, room for the
 * tree beside a file. It measures `clientWidth` on mount, then follows a ResizeObserver; a width of 0 (a
 * `display:none` pane) keeps the last value.
 */
export function useFilesTreeCanFit(ref: RefObject<HTMLElement | null>): boolean
{
	const [canFit, setCanFit] = useState(true);
	useLayoutEffect(() =>
	{
		const body = ref.current;
		if (body === null) return undefined;
		const update = (width: number): void =>
		{
			if (width > 0) setCanFit(width >= FILES_TREE_FIT_MIN_WIDTH);
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
