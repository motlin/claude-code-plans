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

export type LargeShapeName = "large-long" | "large-wide";

const LARGE_SHAPE_NAMES: readonly LargeShapeName[] = ["large-long", "large-wide"];

/**
 * Shape-coupled ceilings: per-append and per-request counts whose large-tier ceilings sit a fixed offset from the
 * typical one, keyed by the typical id. The large tier only runs in merge-group CI (`PERF_LARGE=1 just perf`), so a
 * change that moves these counts moves typical locally and large in CI by the same amount; pinning the offsets makes
 * the plain test run fail when only typical moved. Size-scaled ids (bytesRead, transcript bytes, one-line read
 * amplification, hot-path call counts) are left out.
 */
export const LARGE_TIER_OFFSETS: Record<string, Record<LargeShapeName, number>> = {
	"server.liveAppend.typical.1.jsonl.fullScans": {"large-long": 0, "large-wide": 0},
	"server.liveAppend.typical.1.sql.count": {"large-long": 20, "large-wide": 6},
	"server.liveAppend.typical.1.sse.payloadBytes": {"large-long": 44, "large-wide": 104},
	"server.liveAppend.typical.20.jsonl.fullScans": {"large-long": 0, "large-wide": 0},
	"server.liveAppend.typical.20.readAmplification": {"large-long": 0, "large-wide": 0},
	"server.liveAppend.typical.20.sql.count": {"large-long": 2, "large-wide": 0},
	"server.liveAppend.typical.20.sse.payloadBytes": {"large-long": 101, "large-wide": 161},
	"server.sessionOpen.typical.detail.jsonl.fullScans": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.detail.proc.spawned": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.detail.resp.bytes": {"large-long": 35, "large-wide": 95},
	"server.sessionOpen.typical.detail.sql.count": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.subagents.jsonl.bytesRead": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.subagents.jsonl.fullScans": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.subagents.proc.spawned": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.subagents.resp.bytes": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.subagents.sql.count": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.transcript.jsonl.fullScans": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.transcript.proc.spawned": {"large-long": 0, "large-wide": 0},
	"server.sessionOpen.typical.transcript.sql.count": {"large-long": 0, "large-wide": 0},
};

/**
 * Returns one message per large-tier ceiling that is not at its pinned offset from the typical ceiling, or that is
 * missing along with its typical counterpart, in key order.
 */
export function findLargeTierDrift(
	ceilings: Ceilings,
	offsets: Record<string, Record<LargeShapeName, number>>,
): string[] {
	return Object.entries(offsets)
		.flatMap(([typicalId, pinned]) =>
			LARGE_SHAPE_NAMES.map((shape) => {
				const largeId = typicalId.replace(".typical.", `.${shape}.`);
				const typical = ceilings[typicalId]?.ceiling;
				const large = ceilings[largeId]?.ceiling;
				if (typical === undefined) return `${typicalId} has no ceiling`;
				if (large === undefined) return `${largeId} has no ceiling`;
				const offset = large - typical;
				if (offset === pinned[shape]) return undefined;
				return `${largeId} is ${large}, ${typicalPlus(offset)}; LARGE_TIER_OFFSETS pins ${typicalPlus(pinned[shape])}`;
			}),
		)
		.filter((message) => message !== undefined)
		.filter((message, index, messages) => messages.indexOf(message) === index)
		.sort();
}

function typicalPlus(offset: number): string {
	return offset < 0 ? `typical - ${-offset}` : `typical + ${offset}`;
}
