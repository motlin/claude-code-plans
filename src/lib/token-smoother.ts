/** Upstream's `mW`: the shortest ramp toward a new count. */
const TOKEN_RAMP_MIN_MS = 300;
/** Upstream's `Xl`: the longest ramp, and the ramp after no previous update. */
const TOKEN_RAMP_MAX_MS = 3000;
/** Upstream's `N0`: a first count ramps up from 0 over this long. */
const TOKEN_FIRST_RAMP_MS = 1200;
/** Upstream's `$xe`: the running tick. */
export const TOKEN_TICK_MS = 100;
/** Upstream's `eSe`: the reduced-motion snap cadence. */
export const TOKEN_REDUCED_TICK_MS = 1000;
/** Upstream's `tSe`: a count that turned positive this recently still ramps up from 0. */
const TOKEN_FIRST_POSITIVE_GATE_MS = 5000;

export interface TokenSmoother
{
	update: (value: number | undefined, now: number) => void;
	snapTo: (value: number, now: number) => void;
	valueAt: (now: number) => number | undefined;
}

/**
 * Upstream's linear smoother `ut()`: ramps toward each new count over the gap since the previous update
 * (clamped 300..3000ms), ramps a first count from 0 over 1200ms, and snaps down.
 */
export function createTokenSmoother(): TokenSmoother
{
	let target: number | undefined;
	let from = 0;
	let start = 0;
	let duration = 0;
	let lastUpdate: number | undefined;

	function valueAt(now: number): number | undefined
	{
		if (target === undefined) return undefined;
		if (duration <= 0) return target;
		const progress = Math.min(1, (now - start) / duration);
		return Math.floor(from + (target - from) * progress);
	}

	function update(value: number | undefined, now: number): void
	{
		if (value === undefined)
		{
			target = undefined;
			duration = 0;
			lastUpdate = undefined;
			return;
		}
		if (value === target) return;
		if (target === undefined)
		{
			from = 0;
			start = now;
			duration = TOKEN_FIRST_RAMP_MS;
			target = value;
			lastUpdate = now;
			return;
		}
		if (value < target)
		{
			target = value;
			duration = 0;
			lastUpdate = now;
			return;
		}
		const gap = lastUpdate === undefined ? TOKEN_RAMP_MAX_MS : now - lastUpdate;
		from = valueAt(now) ?? value;
		start = now;
		duration = Math.min(TOKEN_RAMP_MAX_MS, Math.max(TOKEN_RAMP_MIN_MS, gap));
		target = value;
		lastUpdate = now;
	}

	function snapTo(value: number, now: number): void
	{
		target = value;
		from = value;
		duration = 0;
		lastUpdate = now;
	}

	return {
		update,
		snapTo,
		valueAt,
	};
}

/**
 * Upstream's `nSe`: whether a mounted display starts at the current count rather than empty. A fresh turn's first
 * count ramps up from 0; a session opened mid-turn shows its real count at once.
 */
export function seedsAtCurrent({
	tokens,
	running,
	firstPositiveAt,
	now,
}: Readonly<
{
	tokens: number;
	running: boolean;
	firstPositiveAt: number | undefined;
	now: number;
}>): boolean
{
	return (
		tokens > 0 &&
		(!running || firstPositiveAt === undefined || now - firstPositiveAt > TOKEN_FIRST_POSITIVE_GATE_MS)
	);
}
