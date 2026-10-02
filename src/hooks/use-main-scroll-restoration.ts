import {useElementScrollRestoration} from "@tanstack/react-router";
import {useState} from "react";

type ScrollRestorationEntry = ReturnType<typeof useElementScrollRestoration>;

/**
 * The `<main>` scroll position the router restores for the current location, as it stood on the location's first
 * render. That is the location's own entry: one saved when it was left (Back/Forward) or persisted across a reload.
 * After a fresh navigation renders, the router copies the left page's `<main>` entry into the new location's, so a
 * later read would report another page's offset as this page's. Reading it then made a session switched to from the
 * sidebar skip its scroll to the latest message and keep the previous session's offset, short of the end.
 *
 * Call it from a component that renders with the new location, such as the route component, not from one that mounts
 * later (after data loads): its first read would already see the copied entry.
 */
export function useMainScrollRestoration(locationKey: string): ScrollRestorationEntry {
	const current = useElementScrollRestoration({id: "main"});
	const [initial, setInitial] = useState({locationKey, entry: current});
	if (initial.locationKey !== locationKey) {
		setInitial({locationKey, entry: current});
		return current;
	}
	return initial.entry;
}
