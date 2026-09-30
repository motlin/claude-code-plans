import type {Ceilings} from "./ratchet";

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
