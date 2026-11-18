import {useCallback, useEffect, useRef, useState} from "react";

import {useShortcut} from "./use-shortcut";
import {isPhoneViewport} from "../lib/palette-loading";
import {setRememberedPaletteMode, usePaletteMode, type PaletteMode} from "../lib/palette-mode-store";
import {startPaletteOpenJourney} from "../lib/perf/field-journeys";

export type {PaletteMode} from "../lib/palette-mode-store";
export type PaletteEntrypoint = "default" | "search";

/**
 * Upstream's `opensSearching` sources (`Kw()`): the sidebar field and the phone-sheet button open the
 * ⌘K default entry (Compose switch and all) but force the Search view for that open.
 */
export type PaletteSource = "sidebar_field" | "mobile";

/** `remember: false` switches the view for this open only, leaving the remembered tab alone. */
export interface PaletteModeChangeOptions
{
	remember?: boolean;
}

export interface PaletteOpenOptions
{
	source?: PaletteSource;
}

let activeOpener: ((entrypoint: PaletteEntrypoint, options?: PaletteOpenOptions) => void) | null = null;

/** Opens the mounted palette from outside the hook, like the sidebar Search field. */
export function openCommandPalette(entrypoint: PaletteEntrypoint, options?: PaletteOpenOptions): void
{
	activeOpener?.(entrypoint, options);
}

export function useCommandPalette()
{
	const [open, setOpen] = useState(false);
	const [entrypoint, setEntrypoint] = useState<PaletteEntrypoint>("default");
	// The remembered tab; the "search" entrypoint forces Search without overwriting it.
	const rememberedMode = usePaletteMode();
	// A searching source forces Search for this open only, without touching the remembered tab.
	const [forcedSearch, setForcedSearch] = useState(false);
	// An unremembered switch (Backspace on an empty Compose) holds until the palette closes.
	const [openOverride, setOpenOverride] = useState<PaletteMode | null>(null);
	// Upstream `[phone]=useState(Wg)`: a phone opens Search and Compose stays unavailable until the next open.
	const [phoneLatched, setPhoneLatched] = useState(false);
	// Upstream `sendHeldRef` (owned by the shortcut host `gE`): while a send is held, every close is refused.
	// Only an open palette holds, and it releases before its own closes.
	const sendHeldRef = useRef(false);
	const openRef = useRef(open);
	openRef.current = open;

	const openPalette = useCallback((next: PaletteEntrypoint, options?: PaletteOpenOptions) =>
	{
		setEntrypoint(next);
		setForcedSearch(options?.source !== undefined);
		setOpenOverride(null);
		setPhoneLatched(isPhoneViewport());
		setOpen(true);
	}, []);

	const toggle = useCallback(() =>
	{
		// Upstream swallows ⌘K while the send is held instead of toggling the palette closed.
		if (sendHeldRef.current) return;
		setEntrypoint("default");
		setForcedSearch(false);
		setOpenOverride(null);
		if (!openRef.current) setPhoneLatched(isPhoneViewport());
		setOpen((prev) => !prev);
	}, []);

	const openSearch = useCallback(() =>
	{
		openPalette("search");
	}, [openPalette]);

	useShortcut(
		"search_or_start",
		(event) =>
		{
			startPaletteOpenJourney(event);
			toggle();
		},
		{
			allowInModal: true,
		},
	);
	useShortcut(
		"search",
		(event) =>
		{
			startPaletteOpenJourney(event);
			openSearch();
		},
		{
			allowInModal: true,
		},
	);

	useEffect(() =>
	{
		activeOpener = openPalette;
		return () =>
		{
			if (activeOpener === openPalette) activeOpener = null;
		};
	}, [openPalette]);

	const onModeChange = useCallback((mode: PaletteMode, options?: PaletteModeChangeOptions) =>
	{
		setEntrypoint("default");
		setForcedSearch(false);
		if (options?.remember === false)
		{
			setOpenOverride(mode);
			return;
		}
		setOpenOverride(null);
		setRememberedPaletteMode(mode);
	}, []);

	const onOpenChange = useCallback((next: boolean) =>
	{
		if (!next && sendHeldRef.current) return;
		if (!next) setOpenOverride(null);
		setOpen(next);
	}, []);

	const onSendHoldChange = useCallback((held: boolean) =>
	{
		sendHeldRef.current = held;
	}, []);

	const mode: PaletteMode =
		entrypoint === "search" || forcedSearch || phoneLatched ? "search" : (openOverride ?? rememberedMode);

	return {
		open,
		entrypoint,
		openPalette,
		toggle,
		onOpenChange,
		mode,
		onModeChange,
		onSendHoldChange,
		composeAvailable: !phoneLatched,
	};
}
