import {cycleFocusRegion} from "../lib/focus-regions";
import {useShortcut} from "./use-shortcut";

/** Bind F6 / ⇧F6 to cycle focus between the marked landmark regions; yields during IME composition. */
export function useFocusRegionShortcuts(): void {
	useShortcut("focus_next_region", (event) => !event.isComposing && cycleFocusRegion(document, "next"));
	useShortcut("focus_previous_region", (event) => !event.isComposing && cycleFocusRegion(document, "previous"));
}
