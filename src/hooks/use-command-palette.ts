import { useCallback, useState } from "react";

import { useShortcut } from "./use-shortcut";

export type PaletteMode = "search" | "compose";

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("search");

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  useShortcut("search_or_start", toggle, { allowInModal: true });

  // ⇧⌘K forces Search; it closes only a palette that is already open in Search.
  const forceSearch = useCallback(() => {
    if (open && mode === "search") {
      setOpen(false);
      return;
    }
    setMode("search");
    setOpen(true);
  }, [open, mode]);
  useShortcut("search", forceSearch, { allowInModal: true });

  return { open, onOpenChange: setOpen, mode, onModeChange: setMode };
}
