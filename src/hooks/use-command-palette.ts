import { useCallback, useState } from "react";

import { useShortcut } from "./use-shortcut";

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useShortcut("search_or_start", toggle, { allowInModal: true });

  return { open, setOpen };
}
