import {useEffect} from "react";

import {cycleFocusRegion, watchAnsweredCards} from "../lib/focus-regions";
import {useShortcut} from "./use-shortcut";

/**
 * Bind F6 / ⇧F6 to cycle focus between the marked landmark regions (yielding
 * during IME composition), and move focus to the composer after a keyboard answer
 * unmounts its question card.
 */
export function useFocusRegionShortcuts(): void
{
	useShortcut("focus_next_region", (event) => !event.isComposing && cycleFocusRegion(document, "next"));
	useShortcut("focus_previous_region", (event) => !event.isComposing && cycleFocusRegion(document, "previous"));
	useEffect(() => watchAnsweredCards(document), []);
}
