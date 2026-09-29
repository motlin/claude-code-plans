import { cycleFocusRegion } from "../lib/focus-regions";
import { useShortcut } from "./use-shortcut";

/** Bind F6 / ⇧F6 to cycle focus between the marked landmark regions. */
export function useFocusRegionShortcuts(): void {
  useShortcut("focus_next_region", () => cycleFocusRegion(document, "next"));
  useShortcut("focus_previous_region", () => cycleFocusRegion(document, "previous"));
}
