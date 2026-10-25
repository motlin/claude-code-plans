import {useCallback, useEffect, useState} from "react";

import {useShortcut} from "./use-shortcut";
import {startPaletteOpenJourney} from "../lib/perf/field-journeys";

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

/**
 * Upstream's `opensSearching` sources (`Kw()`): the sidebar field and the phone-sheet button open the
 * ⌘K default entry (Compose switch and all) but force the Search view for that open.
 */
export type PaletteSource = "sidebar_field" | "mobile";

/** `remember: false` switches the view for this open only, leaving the remembered tab alone. */
export interface PaletteModeChangeOptions {
	remember?: boolean;
}

export interface PaletteOpenOptions {
	source?: PaletteSource;
}

let activeOpener: ((entrypoint: PaletteEntrypoint, options?: PaletteOpenOptions) => void) | null = null;

/** Opens the mounted palette from outside the hook, like the sidebar Search field. */
export function openCommandPalette(entrypoint: PaletteEntrypoint, options?: PaletteOpenOptions): void {
	activeOpener?.(entrypoint, options);
}

export function useCommandPalette() {
	const [open, setOpen] = useState(false);
	const [entrypoint, setEntrypoint] = useState<PaletteEntrypoint>("default");
	// The remembered tab; the "search" entrypoint forces Search without overwriting it.
	const [rememberedMode, setRememberedMode] = useState<PaletteMode>(readStoredMode);
	// A searching source forces Search for this open only, without touching the remembered tab.
	const [forcedSearch, setForcedSearch] = useState(false);
	// An unremembered switch (Backspace on an empty Compose) holds until the palette closes.
	const [openOverride, setOpenOverride] = useState<PaletteMode | null>(null);

	const openPalette = useCallback((next: PaletteEntrypoint, options?: PaletteOpenOptions) => {
		setEntrypoint(next);
		setForcedSearch(options?.source !== undefined);
		setOpenOverride(null);
		setOpen(true);
	}, []);

	const toggle = useCallback(() => {
		setEntrypoint("default");
		setForcedSearch(false);
		setOpenOverride(null);
		setOpen((prev) => !prev);
	}, []);

	const openSearch = useCallback(() => {
		openPalette("search");
	}, [openPalette]);

	useShortcut(
		"search_or_start",
		(event) => {
			startPaletteOpenJourney(event);
			toggle();
		},
		{allowInModal: true},
	);
	useShortcut(
		"search",
		(event) => {
			startPaletteOpenJourney(event);
			openSearch();
		},
		{allowInModal: true},
	);

	useEffect(() => {
		activeOpener = openPalette;
		return () => {
			if (activeOpener === openPalette) activeOpener = null;
		};
	}, [openPalette]);

	const onModeChange = useCallback((mode: PaletteMode, options?: PaletteModeChangeOptions) => {
		setEntrypoint("default");
		setForcedSearch(false);
		if (options?.remember === false) {
			setOpenOverride(mode);
			return;
		}
		setOpenOverride(null);
		setRememberedMode(mode);
		writeStoredMode(mode);
	}, []);

	const onOpenChange = useCallback((next: boolean) => {
		if (!next) setOpenOverride(null);
		setOpen(next);
	}, []);

	const mode: PaletteMode = entrypoint === "search" || forcedSearch ? "search" : (openOverride ?? rememberedMode);

	return {
		open,
		entrypoint,
		openPalette,
		toggle,
		onOpenChange,
		mode,
		onModeChange,
	};
}
