import {useEffect, useRef, useState} from "react";

export interface ShowMoreState
{
	expanded: boolean;
	/** The first row the toggle reveals, which a keyboard press focuses. */
	firstNewRow: (element: HTMLElement | null) => void;
	toggle: (fromKeyboard: boolean) => void;
}

/** Upstream's in-place Show more: a keyboard expand focuses the first newly shown row. */
export function useShowMore(): ShowMoreState
{
	const [expanded, setExpanded] = useState(false);
	const firstNewRow = useRef<HTMLElement | null>(null);
	const focusFirstNew = useRef(false);
	useEffect(() =>
	{
		if (!focusFirstNew.current) return;
		focusFirstNew.current = false;
		firstNewRow.current?.focus();
	}, [expanded]);
	return {
		expanded,
		firstNewRow: (element) =>
		{
			firstNewRow.current = element;
		},
		toggle: (fromKeyboard) =>
		{
			focusFirstNew.current = !expanded && fromKeyboard;
			setExpanded(!expanded);
		},
	};
}
