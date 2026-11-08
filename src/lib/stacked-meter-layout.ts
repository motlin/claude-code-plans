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

/** A chart colour token name (upstream's `--cds-chart-*`). */
export type ChartColor =
	| "muted"
	| "reference"
	| "status-good"
	| "status-warning"
	| "status-serious"
	| "status-critical"
	| `categorical-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export interface MeterColorCategory {
	id: string;
	color?: ChartColor | undefined;
	ghost?: boolean | undefined;
}

const CATEGORICAL: readonly ChartColor[] = [
	"categorical-1",
	"categorical-2",
	"categorical-3",
	"categorical-4",
	"categorical-5",
	"categorical-6",
	"categorical-7",
	"categorical-8",
];

/**
 * Upstream's `K`: an explicit colour wins, ghost categories take the reference colour, and the rest take categorical-1
 * to 8 in order, skipping the categorical colours non-ghost categories claimed, then muted.
 */
export function assignMeterColors(categories: readonly MeterColorCategory[]): ChartColor[] {
	const claimed = new Set(categories.filter((c) => c.ghost !== true).map((c) => c.color));
	const free = CATEGORICAL.filter((color) => !claimed.has(color));
	let next = 0;
	return categories.map((c) => c.color ?? (c.ghost === true ? "reference" : (free[next++] ?? "muted")));
}

/** A chart colour's paint (upstream's `H`). */
export function chartPaint(color: ChartColor): string {
	return `var(--chart-${color})`;
}

const INK: Partial<Record<ChartColor, string>> = {
	"categorical-4": "text-neutral-900",
	muted: "text-neutral-900",
	"status-warning": "text-gray-900",
};

/** The ink of a value printed on a chart colour (upstream's `we`). */
export function chartInk(color: ChartColor): string {
	return INK[color] ?? "text-gray-0";
}

export interface MeterRowCategory {
	id: string;
	value?: ((values: Readonly<Record<string, number>>) => number) | undefined;
}

export interface MeterRow {
	id: string;
	amount: number;
	share: number;
}

/**
 * Upstream's `me`: each category's amount (its own `value` or `values[id]`, non-finite and negative as 0) and share
 * of `total`, or of the sum when there is no total or the sum passes it. A total that isn't a positive number zeroes
 * every share.
 */
export function meterRows(
	categories: readonly MeterRowCategory[],
	values: Readonly<Record<string, number>>,
	total: number | undefined,
): MeterRow[] {
	let sum = 0;
	const rows = categories.map((category) => {
		const raw = category.value === undefined ? values[category.id] : category.value(values);
		const amount = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
		sum += amount;
		return {id: category.id, amount};
	});
	if (total !== undefined && !(Number.isFinite(total) && total > 0)) return rows.map((row) => ({...row, share: 0}));
	const denominator = total === undefined || sum > total ? sum : total;
	return rows.map((row) => ({...row, share: sum > 0 ? row.amount / denominator : row.amount}));
}

export interface StackedMeterBlocks {
	/** The sum of the positive shares. */
	run: number;
	blocks: {index: number; grow: number}[];
	/** Whether the unfilled track is at least a pixel wide after its 2px gap. */
	rest: boolean;
}

/**
 * Upstream's lg layout `O`: blocks 2px apart in a run at least 4px wide, dropping the smallest while they can't each
 * get 2px, then flooring each block's flex grow to 2px.
 */
export function layoutStackedMeterBlocks(shares: readonly number[], widthPx: number): StackedMeterBlocks {
	const share = (i: number) => shares[i] ?? 0;
	const sumOf = (indexes: readonly number[]) => indexes.reduce((sum, i) => sum + share(i), 0);
	let indexes = shares.flatMap((s, i) => (s > EPS ? [i] : []));
	const run = sumOf(indexes);
	const outer = Math.max(run * widthPx, 4);
	const space = () => outer - (indexes.length - 1) * 2;
	while (indexes.length > 1 && space() <= indexes.length * 2) {
		const smallest = indexes.reduce((min, i) => (share(i) <= share(min) ? i : min));
		if (share(smallest) * space() >= sumOf(indexes)) break;
		indexes = indexes.filter((i) => i !== smallest);
	}
	const kept = sumOf(indexes);
	const grows = floorShares(
		indexes.map((i) => share(i) / kept),
		() => 2 / space(),
	);
	return {
		run,
		blocks: indexes.map((index, i) => ({index, grow: grows[i] ?? 0})),
		rest: (1 - run) * widthPx - 2 >= 1,
	};
}

/** Keeps -0 from printing as "-0" (upstream's `V`). */
function unsigned(format: (n: number) => string): (n: number) => string {
	const zero = format(0);
	const negativeZero = format(-0);
	return (n) => {
		const text = format(n);
		return text === negativeZero ? zero : text;
	};
}

const WHOLE = new Intl.NumberFormat("en-US");
const SIGNIFICANT = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
	maximumSignificantDigits: 3,
	roundingPriority: "morePrecision",
});

/** Upstream's default meter amount (`ge(locale, {significant: true})`): integers in full, else 3 significant digits. */
export const formatMeterAmount = unsigned((n) => (Number.isInteger(n) ? WHOLE.format(n) : SIGNIFICANT.format(n)));

const FOUR_SIGNIFICANT = new Intl.NumberFormat("en-US", {maximumSignificantDigits: 4});
const COMPACT = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumSignificantDigits: 3,
});

/** Upstream's printed lg amount (`Se`): compact from 10,000, else 4 significant digits. */
export const formatPrintedAmount = unsigned((n) =>
	(Math.round(Math.abs(n)) >= 10_000 ? COMPACT : FOUR_SIGNIFICANT).format(n),
);

const GRAPHEMES = new Intl.Segmenter("en-US", {granularity: "grapheme"});
/** Upstream's readout label keeps the tail of labels longer than this many graphemes (`W`). */
const LABEL_TAIL_AFTER = 30;

/**
 * Upstream's readout label `G`: a label over 30 graphemes keeps its last 8 in an unclipped tail after a truncating
 * head, unless whitespace splits it there. An empty tail means the label truncates whole.
 */
export function readoutLabelParts(label: string): {head: string; tail: string} {
	const graphemes = Array.from(GRAPHEMES.segment(label), (segment) => segment.segment);
	const tail = graphemes.length > LABEL_TAIL_AFTER ? graphemes.slice(-8).join("") : "";
	const head = label.slice(0, label.length - tail.length);
	if (tail === "" || /\s$/.test(head) || /^\s/.test(tail)) return {head: label, tail: ""};
	return {head, tail};
}
