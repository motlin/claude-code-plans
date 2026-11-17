import {createContext, useContext} from "react";

/**
 * Upstream's row card coordination (`kI`, provided by the session hover-card hook `rrG`): the PR card
 * stays closed while the session card or the row menu is open, and the session card while the PR card
 * or the row menu is open.
 */
export interface PrCardContextValue
{
	rowCardOpen: boolean;
	menuOpen: boolean;
	onPrCardOpenChange: (open: boolean) => void;
	onMenuOpenChange: (open: boolean) => void;
}

function ignore(): void
{
	// Outside a session row there is no card to coordinate with.
}

export const PrCardContext = createContext<PrCardContextValue>(
	{
		rowCardOpen: false,
		menuOpen: false,
		onPrCardOpenChange: ignore,
		onMenuOpenChange: ignore,
	},
);

export function usePrCardContext(): PrCardContextValue
{
	return useContext(PrCardContext);
}
