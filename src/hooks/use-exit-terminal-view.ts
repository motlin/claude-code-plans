import {useRouter} from "@tanstack/react-router";
import {useCallback} from "react";

/**
 * Upstream `Yi` (cd9c8436e): leave the terminal view by dropping `view` from the search params
 * with a history replace, keeping every other param and the hash.
 */
export function useExitTerminalView(): () => void
{
	const router = useRouter();
	return useCallback(() =>
	{
		const location = router.state.location;
		const params = new URLSearchParams(location.searchStr);
		params.delete("view");
		const search = params.toString();
		router.history.replace(
			`${location.pathname}${search === "" ? "" : `?${search}`}${location.hash === "" ? "" : `#${location.hash}`}`,
		);
	}, [router]);
}
