/** A crayon stroke: one path, drawn at `width` with an optional own transform. */
export interface CrayonStroke
{
	d: string;
	width: number;
	transform?: string;
}

/** A kind's crayon art (upstream `G` in cb2e35da5): where it sits, its grain seed and warp, and its strokes. */
export interface CrayonArt
{
	transform: string;
	noiseSeed: number;
	warp: number;
	strokes: CrayonStroke[];
}

type Point = readonly [x: number, y: number];

/** Upstream's art canvas (`l` × `u`), the placement slots (`y`) and the art scale (`b`). */
const CANVAS_WIDTH = 115;
const CANVAS_HEIGHT = 80;
const SLOTS: readonly Point[] = [
	[0.32, 0.3],
	[-0.3, 0.28],
	[0.3, -0.26],
	[-0.28, -0.28],
	[0, 0.36],
];
const ART_SCALE = 1.15;

/** Upstream's Docs stroke width (`E`), copy offset (`D`) and line scale (`O`). */
const LINE_WIDTH = 1.4;
const LINE_SHIFT = 1.2;
const LINE_SCALE = 2.6;

/** Upstream `f`: an `M`/`L` path through the points at one decimal. */
function pathD(points: readonly Point[]): string
{
	return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

/** Upstream `p`: the stroke, then a thinner copy `shift` lower, so the line reads as crayon. */
function pair(points: readonly Point[], width: number, shift: number): CrayonStroke[]
{
	return [
		{
			d: pathD(points),
			width,
		},
		{
			d: pathD(points.map(([x, y]) => [x, y + shift])),
			width: Math.max(1, width - 2),
		},
	];
}

/** Upstream `S`: the art's slot on the canvas, scaled about the 115 × 80 art box. */
function placement(place: number): string
{
	const [dx, dy] = SLOTS[place % SLOTS.length] ?? [0, 0];
	return `translate(${(CANVAS_WIDTH / 2 + dx * CANVAS_WIDTH).toFixed(1)} ${(CANVAS_HEIGHT / 2 + dy * CANVAS_HEIGHT).toFixed(1)}) scale(${ART_SCALE}) translate(${-115 / 2} -40)`;
}

/** Upstream's art table (`B`), keyed by kind so slides, design, chart, animation and scales can join it. */
const ART =
{
	document:
	{
		place: 0,
		warp: 1.6,
		// Two zig-zag scribble lines, each a stroke and its shifted copy.
		strokes: (): CrayonStroke[] =>
			(
				[
					[60, 4],
					[34, 21],
				] as const
			).flatMap(([length, y]) =>
			{
				const points: Point[] = [];
				for (let x = 0; x <= length; x += 0.5)
				{
					points.push([x, y - 4 + 8 * Math.abs(Math.sin((x / 9) * Math.PI))]);
				}
				return pair(points, LINE_WIDTH, LINE_SHIFT).map((stroke) => (
				{
					...stroke,
					transform: `translate(-14 6) rotate(7) scale(${LINE_SCALE})`,
				}));
			}),
	},
} as const;

export type CrayonKind = keyof typeof ART;

export function crayonArt(kind: CrayonKind): CrayonArt
{
	const {place, warp, strokes} = ART[kind];
	return {
		transform: placement(place),
		noiseSeed: place * 7 + 3,
		warp,
		strokes: strokes(),
	};
}
