/**
 * F6 / ⇧F6 landmark focus cycling, like claude.ai/code's focus_next_region /
 * focus_previous_region. Regions are marked with `data-focus-region` and
 * cycle in document order; the innermost region holding focus is current.
 * A region focuses its `data-focus-region-entry` descendant when it has one
 * (the composer's prompt), otherwise the region element itself.
 */

export const FOCUS_REGION_ATTR = "data-focus-region";
export const FOCUS_REGION_ENTRY_ATTR = "data-focus-region-entry";

export type FocusRegionDirection = "next" | "previous";

function isAvailable(region: HTMLElement): boolean {
	if (region.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
	return typeof region.checkVisibility === "function" ? region.checkVisibility() : true;
}

function focusRegion(region: HTMLElement): void {
	const entry = [...region.querySelectorAll<HTMLElement>(`[${FOCUS_REGION_ENTRY_ATTR}]`)].find(
		(candidate) => candidate.closest(`[${FOCUS_REGION_ATTR}]`) === region,
	);
	if (entry !== undefined) {
		entry.focus();
		return;
	}
	if (region.tabIndex < 0 && !region.hasAttribute("tabindex")) region.tabIndex = -1;
	region.focus({preventScroll: true});
}

/** Move focus to the next or previous available region; false when there is none. */
export function cycleFocusRegion(root: Document, direction: FocusRegionDirection): boolean {
	const regions = [...root.querySelectorAll<HTMLElement>(`[${FOCUS_REGION_ATTR}]`)].filter(isAvailable);
	if (regions.length === 0) return false;
	const active = root.activeElement;
	const current = active === null ? undefined : active.closest<HTMLElement>(`[${FOCUS_REGION_ATTR}]`);
	const index = current === undefined || current === null ? -1 : regions.indexOf(current);
	const step = direction === "next" ? 1 : -1;
	const start = index === -1 ? (direction === "next" ? -1 : regions.length) : index;
	const target = regions[(start + step + regions.length) % regions.length];
	if (target === undefined) return false;
	focusRegion(target);
	return true;
}
