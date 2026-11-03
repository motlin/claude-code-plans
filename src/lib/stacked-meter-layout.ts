/* A port of upstream's cds StackedMeter segment layout (`le`/`E` in c91b6e9db). */

const EPS = 1e-12;

export interface StackedMeterSegment {
	/** The share's index in the input. */
	index: number;
	/** Where the segment starts, as a share of the meter. */
	start: number;
	/** The segment's width, as a share of the meter, before its seam is taken off. */
	width: number;
	/** The 1px gap before every segment but the first. */
	seam: 0 | 1;
	radiusStart: number;
	radiusEnd: number;
}

export type StackedMeterLayout =
	| {kind: "empty"}
	| {kind: "dot"; index: number}
	| {kind: "segments"; segments: StackedMeterSegment[]};

/**
 * Raises each positive share to its minimum, taking the deficit out of the larger shares in proportion to their
 * surplus. When the surplus can't cover the deficit the shares stay raw (upstream's `E`).
 */
function floorShares(shares: readonly number[], min: (index: number) => number): readonly number[] {
	const excess = shares.map((share, i) => (share > EPS ? share - min(i) : 0));
	const deficit = -excess.reduce((sum, n) => sum + Math.min(n, 0), 0);
	const surplus = excess.reduce((sum, n) => sum + Math.max(n, 0), 0);
	if (deficit === 0 || deficit > surplus) return shares;
	return shares.map((share, i) => {
		const n = excess[i] ?? 0;
		return share - n * (n < 0 ? 1 : deficit / surplus);
	});
}

/**
 * Lays out a size-sm meter's segments at `widthPx`: every visible segment is at least 2px, the first starts and the
 * last ends fully rounded, and a run narrower than the meter is tall collapses to a dot in the largest share's color.
 */
export function layoutStackedMeter(shares: readonly number[], widthPx: number, heightPx: number): StackedMeterLayout {
	let largest = -1;
	let max = EPS;
	shares.forEach((share, i) => {
		if (share > max) {
			largest = i;
			max = share;
		}
	});
	if (largest < 0) return {kind: "empty"};
	const firstPositive = shares.findIndex((share) => share > EPS);
	const floored = floorShares(shares, (i) => (2 + (i === firstPositive ? 0 : 1)) / widthPx);
	const inner = Math.min(4, heightPx / 4);
	const segments: StackedMeterSegment[] = [];
	let start = 0;
	floored.forEach((share, index) => {
		if (!(share > 0)) return;
		const seam = segments.length === 0 ? 0 : 1;
		if (share * widthPx - seam >= 1) {
			segments.push({
				index,
				start,
				width: share,
				seam,
				radiusStart: seam === 0 ? heightPx / 2 : inner,
				radiusEnd: inner,
			});
		}
		start += share;
	});
	const first = segments[0];
	const last = segments.at(-1);
	if (first === undefined || last === undefined || (last.start + last.width - first.start) * widthPx < heightPx) {
		return {kind: "dot", index: largest};
	}
	segments[segments.length - 1] = {...last, radiusEnd: heightPx / 2};
	return {kind: "segments", segments};
}

/** A share as a percent rounded to 3 decimals, as upstream prints segment geometry (`F`). */
export function meterPercent(share: number): number {
	return Number((share * 100).toFixed(3));
}
