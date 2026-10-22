/**
 * Vertical drag-to-dismiss geometry for bottom sheets, decoded from claude.ai/code's cds sheet
 * frame (`d6`, `fb`, `H3`, `so`, `_1`, `c8`, `d$` in shared-frame). `raw` is the height the finger
 * asks for: above `rest` the sheet grows, below it the sheet slides down.
 */
export const SHEET_DRAG = {
	detentThreshold: 40,
	dismissFraction: 0.25,
	flingVelocity: 0.8,
	rubberBand: 0.55,
	overshootRoom: 0.5,
} as const;

/** A release more than this long after the last move counts as velocity 0. */
const STALE_MOVE_MS = 100;

export type SheetDetent = "default" | "tall";

export interface SheetGeometry {
	/** The sheet's resting height. */
	rest: number;
	/** The tall detent's height; equal to `rest` when the sheet cannot grow. */
	tall: number;
	/** How far past `tall` the rubber band can stretch. */
	room: number;
}

export interface SheetFollow {
	height: number;
	slide: number;
	/** How much of the sheet is still shown, driving the scrim's opacity. */
	shown: number;
}

/** Upstream's fb: overshoot past `tall`, damped into `room`. */
export function rubber(over: number, room: number): number {
	return over <= 0 || room <= 0 ? 0 : (1 - 1 / ((over * SHEET_DRAG.rubberBand) / room + 1)) * room;
}

/** Upstream's H3: the inverse of `rubber`, so a grab on a banded sheet resumes where the finger is. */
export function unrubber(banded: number, room: number): number {
	return banded <= 0 || room <= 0
		? 0
		: ((1 / (1 - Math.min(banded, room * 0.9) / room) - 1) * room) / SHEET_DRAG.rubberBand;
}

/** Upstream's so: the tall detent snaps back to `rest` when it is within the detent threshold. */
export function sheetGeometry(rest: number, available: number, tallFraction: number, canGrow = true): SheetGeometry {
	const candidate = Math.max(available * tallFraction, rest);
	const tall = !canGrow || candidate - rest < SHEET_DRAG.detentThreshold ? rest : candidate;
	return {rest, tall, room: Math.max(0, (available - tall) * SHEET_DRAG.overshootRoom)};
}

function canReachTall(geometry: SheetGeometry): boolean {
	return geometry.tall > geometry.rest;
}

/** Upstream's _1: the height, slide and shown fraction for a raw finger position. */
export function follow(geometry: SheetGeometry, raw: number): SheetFollow {
	if (raw > geometry.tall) {
		return {height: geometry.tall + rubber(raw - geometry.tall, geometry.room), slide: 0, shown: 1};
	}
	if (raw >= geometry.rest) return {height: raw, slide: 0, shown: 1};
	const slide = geometry.rest - raw;
	return {height: geometry.rest, slide, shown: 1 - Math.min(1, slide / Math.max(1, geometry.rest))};
}

/** Upstream's c8: the raw position for a grabbed sheet's current height and slide. */
export function rawAt(geometry: SheetGeometry, height: number, caughtSlide: number): number {
	return height > geometry.tall
		? geometry.tall + unrubber(height - geometry.tall, geometry.room)
		: Math.min(height, geometry.tall) - Math.max(0, caughtSlide);
}

export interface SheetRelease {
	detent: SheetDetent;
	rawAtGrab: number;
	rawAtRelease: number;
	/** How far the sheet was already slid when the finger caught it. */
	caughtSlide: number;
	/** px/ms, positive downward. */
	velocity: number;
	msSinceMove: number;
	/** False for a pointercancel or lost capture: never dismiss, keep the detent. */
	commit: boolean;
}

/** Upstream's d$: dismiss past a quarter of `rest` or on a downward fling, else settle on a detent. */
export function release(geometry: SheetGeometry, input: SheetRelease): {dismiss: boolean; detent: SheetDetent} {
	const {detent, rawAtGrab, rawAtRelease, caughtSlide, commit} = input;
	const velocity = input.msSinceMove > STALE_MOVE_MS ? 0 : input.velocity;
	const {slide} = follow(geometry, rawAtRelease);
	const dismiss =
		commit &&
		slide > 0 &&
		(slide - caughtSlide > geometry.rest * SHEET_DRAG.dismissFraction ||
			(detent === "default" && velocity > SHEET_DRAG.flingVelocity));
	if (!commit || dismiss) return {dismiss, detent};
	if (rawAtGrab > geometry.rest && rawAtGrab < geometry.tall) {
		const moved = rawAtRelease - rawAtGrab;
		if (moved > SHEET_DRAG.detentThreshold && canReachTall(geometry)) return {dismiss: false, detent: "tall"};
		if (moved < -SHEET_DRAG.detentThreshold) return {dismiss: false, detent: "default"};
		return {dismiss: false, detent};
	}
	if (detent === "default" && canReachTall(geometry) && rawAtRelease > geometry.rest + SHEET_DRAG.detentThreshold) {
		return {dismiss: false, detent: "tall"};
	}
	if (detent === "tall" && rawAtRelease < geometry.tall - SHEET_DRAG.detentThreshold) {
		return {dismiss: false, detent: "default"};
	}
	return {dismiss: false, detent};
}
