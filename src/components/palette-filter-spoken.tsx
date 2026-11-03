import {useEffect, useRef, useState} from "react";

/** Upstream's `km` waits this long after a filter change before announcing it. */
const SPEAK_DELAY_MS = 500;
/** ...and empties the region this long after the change, so a reread finds nothing stale. */
const CLEAR_DELAY_MS = 3500;

/**
 * Upstream's `palette-filter-spoken` status region: each change of `filterKey` after the first
 * render announces `words` 500ms later and clears it 3.5s after the change. Opening the palette
 * and re-renders with the same filters announce nothing.
 */
export function PaletteFilterSpoken({filterKey, words}: {filterKey: string; words: string}) {
	const [change, setChange] = useState({filterKey, count: 0});
	if (change.filterKey !== filterKey) setChange({filterKey, count: change.count + 1});
	const [spoken, setSpoken] = useState<{count: number; words: string} | null>(null);
	const latestWords = useRef(words);
	latestWords.current = words;
	const {count} = change;

	useEffect(() => {
		if (count === 0) return undefined;
		const speak = setTimeout(() => {
			setSpoken({count, words: latestWords.current});
		}, SPEAK_DELAY_MS);
		const clear = setTimeout(() => {
			setSpoken(null);
		}, CLEAR_DELAY_MS);
		return () => {
			clearTimeout(speak);
			clearTimeout(clear);
		};
	}, [count]);

	return (
		<div
			role="status"
			aria-live="polite"
			aria-atomic="true"
			className="sr-only"
			data-testid="palette-filter-spoken"
		>
			{spoken !== null && spoken.words !== "" && <span key={spoken.count}>{spoken.words}</span>}
		</div>
	);
}
