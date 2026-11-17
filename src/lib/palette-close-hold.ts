import {paletteSearchable} from "./palette-quick-action";
import type {PaletteFilters} from "./palette-tokens";

/**
 * Upstream's auto-close hold (palette body `D_` reporting to host `ik`'s `F`): `none` lets route changes and
 * other dialogs close the palette, `input` survives route changes only, `all` survives both.
 */
export type PaletteCloseHold = "none" | "input" | "all";

export type PaletteAutoCloseReason = "route" | "dialog";

export interface PaletteCloseHoldInput
{
	mode: "search" | "compose";
	entrypoint: "default" | "search";
	search: string;
	compose: string;
	attachments: number;
	filters: PaletteFilters;
	/** Local `launching` is upstream's held send; the picker step belongs to the same send flow. */
	startStep: "idle" | "picker" | "launching";
}

/**
 * Upstream's committed-filter check (`W && ao(G)`, `W` false in the Actions view). Local Actions is a
 * filter, so it is the view and does not count.
 */
function hasFilter({date, repo, project, archived}: PaletteFilters): boolean
{
	return date !== undefined || repo !== undefined || project !== undefined || archived !== undefined;
}

/** Port of upstream's `ei`/`qr` hold, with the host's send hold (`F = held || draft ? "all" : hold`). */
export function paletteCloseHold({
	mode,
	entrypoint,
	search,
	compose,
	attachments,
	filters,
	startStep,
}: PaletteCloseHoldInput): PaletteCloseHold
{
	if (startStep !== "idle") return "all";
	const composing = mode === "compose";
	const active = composing ? compose : search;
	// Upstream `on(e)`: the search-only entry always searches; the default view searches up to 50 raw characters.
	const searches = !composing && (entrypoint === "search" || paletteSearchable(active));
	const draft =
		(composing && compose !== "") || compose.trim() !== "" || attachments > 0 || (active !== "" && !searches);
	if (draft) return "all";
	const idle = search === "" && compose === "" && !hasFilter(filters);
	return idle ? "none" : "input";
}

/** Upstream `A7`'s close gate: `all` refuses both reasons, `input` refuses only a route change. */
export function shouldAutoClose(hold: PaletteCloseHold, reason: PaletteAutoCloseReason): boolean
{
	return !(hold === "all" || (hold === "input" && reason === "route"));
}

/**
 * Upstream `YI`, plus `data-palette-owned`: upstream portals the palette's own overlays outside the watched
 * `#portal-root`, while every local dialog portals to `body`, so palette-owned popups opt out explicitly.
 */
export const PALETTE_OVERLAY_SELECTOR =
	':is([role="alertdialog"],[aria-modal="true"],[data-cds="Dialog"],[data-cds="ConfirmationDialog"]):not([aria-modal="false"],[data-closed],[data-palette-owned])';
