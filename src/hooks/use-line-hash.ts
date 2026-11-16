import {useEffect} from "react";

import {parseFileLineRangeHash} from "../components/file-viewer-utils";

export interface HashLineRange
{
	line: number;
	endLine: number;
}

/**
 * Follow the page's `#L<n>[-L<m>]` hash: reports the current range (null without one) on mount,
 * whenever `onRange` or `resetKey` changes, and on every `hashchange`. Off while `enabled` is false.
 */
export function useLineHash(enabled: boolean, onRange: (range: HashLineRange | null) => void, resetKey?: unknown): void
{
	useEffect(() =>
	{
		if (!enabled) return undefined;
		const handleHashChange = () =>
		{
			onRange(parseFileLineRangeHash(window.location.hash));
		};
		handleHashChange();
		window.addEventListener("hashchange", handleHashChange);
		return () =>
		{
			window.removeEventListener("hashchange", handleHashChange);
		};
	}, [enabled, onRange, resetKey]);
}
