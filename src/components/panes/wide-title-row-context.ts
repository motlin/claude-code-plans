import {createContext, useContext} from "react";

/**
 * Upstream cc43287c9 `tFe`'s slot (shared-20 `hQ`), provided around the chat tile while the wide title row is on: the
 * row element, whether the chat sits on the layout's top edge, and the callback the lifted header reports through.
 */
export interface WideTitleRowSlot
{
	el: HTMLElement | null;
	overChat: boolean;
	onRowLifted: (lifted: boolean) => void;
}

export const WideTitleRowContext = createContext<WideTitleRowSlot | null>(null);

/** Upstream `vr`'s `overChat`: the chat's drop badge starts below the row. */
export function useWideTitleRowOverChat(): boolean
{
	return useContext(WideTitleRowContext)?.overChat ?? false;
}
