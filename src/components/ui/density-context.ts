import {createContext, useContext} from "react";

import {useCoarsePointer} from "../../lib/use-phone-sheet";

export type Density = "compact" | "comfortable";

/*
 * Upstream's cds density scope (`si` in shared-frame). The context default is
 * comfortable (`JU=ED("comfortable")`), so the shell and sidebar are comfortable;
 * the Claude Code main column wraps itself in a compact scope. Portals copy the
 * density of the scope that opened them.
 */
export const DensityContext = createContext<Density>("comfortable");

/* Upstream's `He` context / `experimental.densityOverride`: wins over the coarse-pointer swap. */
export const DensityOverrideContext = createContext<Density | undefined>(undefined);

export function useDensity(): Density {
	return useContext(DensityContext);
}

/**
 * Resolves a scope's density in upstream `si`'s order: an ancestor override, then
 * comfortable on a coarse pointer (live, `false` on the server), then the scope's own
 * density, then the inherited one.
 */
export function useScopeDensity(density?: Density): Density {
	const override = useContext(DensityOverrideContext);
	const coarse = useCoarsePointer();
	const inherited = useContext(DensityContext);
	return override ?? (coarse ? "comfortable" : (density ?? inherited));
}
