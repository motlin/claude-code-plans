import type {ReactNode} from "react";

import {DensityScope} from "../src/components/ui/density";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";

const WITHOUT_PANELS: readonly FizzyLakePart[] = ["color", "type"];

/**
 * Fizzy-lake `panels` off: upstream's pre-rollout layout, where an explicit compact scope
 * (the Claude Code main column, a compact menu) holds on a fine pointer. Under panels every
 * scope is comfortable, so tests of the compact metrics render inside this.
 */
export function PanelsOff({children}: {children: ReactNode}) {
	return <FizzyLakeContext.Provider value={WITHOUT_PANELS}>{children}</FizzyLakeContext.Provider>;
}

/** The pre-rollout compact main column. */
export function CompactScope({children}: {children: ReactNode}) {
	return (
		<PanelsOff>
			<DensityScope density="compact">{children}</DensityScope>
		</PanelsOff>
	);
}
