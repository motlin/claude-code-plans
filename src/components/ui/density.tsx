import {createContext, type ReactNode, useContext} from "react";

import {useCoarsePointer} from "../../lib/use-phone-sheet";

export type Density = "compact" | "comfortable";

/*
 * Upstream's cds density scope (`si` in shared-frame). The context default is
 * comfortable (`JU=ED("comfortable")`), so the shell and sidebar are comfortable;
 * the Claude Code main column wraps itself in a compact scope. Portals copy the
 * density of the scope that opened them.
 */
const DensityContext = createContext<Density>("comfortable");

/* Upstream's `He` context / `experimental.densityOverride`: wins over the coarse-pointer swap. */
const DensityOverrideContext = createContext<Density | undefined>(undefined);

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

export function DensityScope({density, children}: {density?: Density; children: ReactNode}) {
	const resolved = useScopeDensity(density);
	return (
		<DensityContext.Provider value={resolved}>
			<div data-density={resolved} className="contents">
				{children}
			</div>
		</DensityContext.Provider>
	);
}

/** Forces every density scope below it, ahead of the coarse-pointer swap. */
export function DensityOverride({density, children}: {density: Density; children: ReactNode}) {
	return <DensityOverrideContext.Provider value={density}>{children}</DensityOverrideContext.Provider>;
}

/** Provides a density without a wrapper, for scopes whose element already carries `data-density`. */
export function DensityProvider({density, children}: {density: Density; children: ReactNode}) {
	return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>;
}
