import type {ReactNode} from "react";

import {type Density, DensityContext, DensityOverrideContext, useScopeDensity} from "./density-context";

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
