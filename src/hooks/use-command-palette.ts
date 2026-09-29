import { useCallback, useEffect, useState } from "react";

import { useShortcut } from "./use-shortcut";

export type PaletteMode = "search" | "compose";
export type PaletteEntrypoint = "default" | "search";

/** Upstream's remembered Search | Compose tab, kept across reloads. */
const PALETTE_MODE_STORAGE_KEY = "cmdk-mode";

function readStoredMode(): PaletteMode {
  try {
    return localStorage.getItem(PALETTE_MODE_STORAGE_KEY) === "compose" ? "compose" : "search";
  } catch {
    return "search";
  }
}

function writeStoredMode(mode: PaletteMode): void {
  try {
    localStorage.setItem(PALETTE_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode); the tab is still remembered for this visit.
  }
}

let activeOpener: ((entrypoint: PaletteEntrypoint) => void) | null = null;

/** Opens the mounted palette from outside the hook, like the sidebar footer Search button. */
export function openCommandPalette(entrypoint: PaletteEntrypoint): void {
  activeOpener?.(entrypoint);
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const [entrypoint, setEntrypoint] = useState<PaletteEntrypoint>("default");
  // The remembered tab; the "search" entrypoint forces Search without overwriting it.
  const [rememberedMode, setRememberedMode] = useState<PaletteMode>(readStoredMode);

  const openPalette = useCallback((next: PaletteEntrypoint) => {
    setEntrypoint(next);
    setOpen(true);
  }, []);

  const toggle = useCallback(() => {
    setEntrypoint("default");
    setOpen((prev) => !prev);
  }, []);

  const openSearch = useCallback(() => openPalette("search"), [openPalette]);

  useShortcut("search_or_start", toggle, { allowInModal: true });
  useShortcut("search", openSearch, { allowInModal: true });

  useEffect(() => {
    activeOpener = openPalette;
    return () => {
      if (activeOpener === openPalette) activeOpener = null;
    };
  }, [openPalette]);

  const onModeChange = useCallback((mode: PaletteMode) => {
    setEntrypoint("default");
    setRememberedMode(mode);
    writeStoredMode(mode);
  }, []);

  const mode: PaletteMode = entrypoint === "search" ? "search" : rememberedMode;

  return {
    open,
    entrypoint,
    openPalette,
    toggle,
    onOpenChange: setOpen,
    mode,
    onModeChange,
  };
}
