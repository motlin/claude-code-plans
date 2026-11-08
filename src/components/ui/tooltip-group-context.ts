import {createContext, useContext} from "react";

/** A group's single open tip: opening another tip in the group closes it. */
export interface TooltipGroupValue {
	claim: (hide: () => void) => void;
	release: (hide: () => void) => void;
	/** How long a tip in the group stays open after the pointer leaves it. */
	closeDelay: number;
}

export const TooltipGroupContext = createContext<TooltipGroupValue | null>(null);

/** Whether a TooltipGroup encloses the caller (upstream's `v0`), so a StackedMeter reuses it instead of nesting one. */
export function useInTooltipGroup(): boolean {
	return useContext(TooltipGroupContext) !== null;
}
