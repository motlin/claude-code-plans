import {createContext, useContext} from "react";

/*
 * Upstream's fizzy-lake rollout (GrowthBook `fizzy_lake_rollout`), which renders
 * `html[data-cds-fizzy-lake="color panels type"]` on the live account:
 * - `color`: the rollout colour tokens.
 * - `panels`: every density scope is comfortable (upstream `si()` in shared-frame) and
 *   the flat panel look. Its smaller control sizes apply on a fine pointer only.
 * - `type`: the type-led Settings rows (upstream `B("type")` in c0db37792 `on()`), and in the
 *   transcript (cds-type-experiment-gate): status labels fade when cut (useRowCut's
 *   `data-cds-row-cut`), Phrases skip measuring, and assistant rows carry
 *   `data-cds-reply-type` for the reply prose CSS.
 * Local follows the whole rollout (upstream-sync Q1, 2026-11-02); drop a part here to
 * fall back to the pre-rollout look for it.
 */
export type FizzyLakePart = "color" | "panels" | "type";

export const FIZZY_LAKE_PARTS: readonly FizzyLakePart[] = ["color", "panels", "type"];

/** The `data-cds-fizzy-lake` value on `<html>`; omitted when no part is on. */
export const FIZZY_LAKE_ATTRIBUTE: string | undefined =
	FIZZY_LAKE_PARTS.length === 0 ? undefined : FIZZY_LAKE_PARTS.join(" ");

export const FIZZY_LAKE_COLOR = FIZZY_LAKE_PARTS.includes("color");
export const FIZZY_LAKE_PANELS = FIZZY_LAKE_PARTS.includes("panels");
export const FIZZY_LAKE_TYPE = FIZZY_LAKE_PARTS.includes("type");

/** The `data-flat-look` value for `<html>`: present ("") while panels is on. */
export function flatLookFor(parts: readonly FizzyLakePart[]): "" | undefined
{
	return parts.includes("panels") ? "" : undefined;
}

/*
 * Upstream shared-m-w-0 `uZ`: `document.documentElement.toggleAttribute("data-flat-look",!0)`,
 * rendered by the app root; the sidebar aside carries it too. Local keeps it tied to panels.
 */
export const FIZZY_LAKE_FLAT_LOOK = flatLookFor(FIZZY_LAKE_PARTS);

/*
 * Upstream `sF`: panels control sizes (28px comfortable controls, toolbar icon box and
 * strip, the flat-look row heights) sit inside this media query, so a coarse device keeps
 * the classic 32px controls. Any JS mirror takes its touch flag from TOUCH_QUERY.
 */
export const FIZZY_LAKE_PANELS_FINE_POINTER_QUERY =
	"(hover: hover) and (pointer: fine), (hover: hover) and (pointer: none)";

/* Upstream's `Y3` context; a subtree can provide its own parts (`experimental.fizzyLake.parts`). */
export const FizzyLakeContext = createContext<readonly FizzyLakePart[]>(FIZZY_LAKE_PARTS);

export function useFizzyLake(part: FizzyLakePart): boolean
{
	return useContext(FizzyLakeContext).includes(part);
}

/** Upstream shared-9 `KH() ? "text-secondary" : "text-muted"`: transcript status ink at rest. */
export function useRestInk(): "text-secondary" | "text-ink-muted"
{
	return useFizzyLake("color") ? "text-secondary" : "text-ink-muted";
}
