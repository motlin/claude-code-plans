import type {Ceilings} from "./ratchet";

/**
 * Tolerance of the `bundle.*` byte ceilings (user decision 2026-10-01, replacing the measurement plan's tolerance 0):
 * the cold-load JS bytes may drift ±1% from the ceiling before the ratchet fails, and a drop larger than the band
 * still fails until the ceiling is lowered. `just verify` gates them locally, right after its build.
 */
export const BUNDLE_BYTES_TOLERANCE = 0.01;

/**
 * Ceiling policy (measurement plan §4.4): a ceiling may only go up with a hand-written `reason` and `raisedAt` on the
 * entry. Returns the ids whose ceiling rose without both, in key order. Lowered, new and removed ids are fine.
 */
export function findUnjustifiedRaises(previous: Ceilings, current: Ceilings): string[] {
	return Object.entries(current)
		.filter(([id, entry]) => {
			const before = previous[id];
			if (before === undefined || entry.ceiling <= before.ceiling) {
				return false;
			}
			return !entry.reason?.trim() || !entry.raisedAt?.trim();
		})
		.map(([id]) => id)
		.sort();
}
