import {createContext, type ReactNode, useContext} from "react";

export type Density = "compact" | "comfortable";

/*
 * Upstream's cds density scope (`si` in shared-frame). The context default is
 * comfortable (`JU=ED("comfortable")`), so the shell and sidebar are comfortable;
 * the Claude Code main column wraps itself in a compact scope. Portals copy the
 * density of the scope that opened them.
 */
const DensityContext = createContext<Density>("comfortable");

export function useDensity(): Density {
	return useContext(DensityContext);
}

export function DensityScope({density, children}: {density: Density; children: ReactNode}) {
	return (
		<DensityContext.Provider value={density}>
			<div data-density={density} className="contents">
				{children}
			</div>
		</DensityContext.Provider>
	);
}

/** Provides a density without a wrapper, for scopes whose element already carries `data-density`. */
export function DensityProvider({density, children}: {density: Density; children: ReactNode}) {
	return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>;
}
