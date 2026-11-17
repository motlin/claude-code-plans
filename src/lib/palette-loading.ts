import type {PaletteMode} from "../hooks/use-command-palette";

export type PaletteLoadingVariant = "compose" | "search";

/**
 * Upstream `v8`'s `$x`: the Compose skeleton only for a remembered Compose that isn't forced to Search. `mode`
 * already folds in the ⇧⌘K entry and the sidebar/phone-button sources; a phone also opens Search.
 */
export function paletteLoadingVariant(mode: PaletteMode, phone: boolean): PaletteLoadingVariant
{
	return mode === "compose" && !phone ? "compose" : "search";
}

/** Upstream's phone test (`Mf()&&HG()`): a coarse or hover-less pointer on a viewport under 40rem. */
export function isPhoneViewport(): boolean
{
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	return (
		window.matchMedia("(pointer: coarse), (hover: none)").matches && window.matchMedia("(width < 40rem)").matches
	);
}

// Upstream `_C`/`_U`: whether this open began on the cold-load skeleton, so the palette takes over without a fade.
let shown = false;

export function setPaletteLoadingShown(next: boolean): void
{
	shown = next;
}

export function paletteLoadingShown(): boolean
{
	return shown;
}
