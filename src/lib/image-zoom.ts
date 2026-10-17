/**
 * Upstream's image-viewer zoom math, decoded in
 * .llm/upstream-sync/dumps/image-viewer-bundle.txt ("Zoom / pan decode").
 */

/** The smallest scale a fit-zoom toggles to, even for an image already at natural size. */
const MIN_MAX_SCALE = 2;
/** Pixels a pointer must travel before a press on a zoomed image counts as a pan. */
export const PAN_THRESHOLD = 4;
/** Pixels per wheel line (and the page fallback). */
export const WHEEL_LINE = 16;
/** Wheel zoom rate: scale multiplies by exp(-deltaY * WHEEL_RATE). */
export const WHEEL_RATE = 0.01;
/** A ctrl+wheel zoom-out at or below this scale snaps back to fit. */
const SNAP_TO_FIT = 1.05;
/** The first ctrl+wheel step from fit zooms at least this far. */
const MIN_FIRST_STEP = 1.25;
/** How much of the viewport a zoomed image must keep covering while panned. */
const PAN_LIMIT_FRACTION = 0.7;

export interface ZoomGeometry {
	fitWidth: number;
	fitHeight: number;
	fitCenterX: number;
	fitCenterY: number;
	maxScale: number;
	viewportWidth: number;
	viewportHeight: number;
}

export interface ZoomState extends ZoomGeometry {
	scale: number;
	idealTx: number;
	idealTy: number;
	tx: number;
	ty: number;
	maxTx: number;
	maxTy: number;
}

interface Point {
	clientX: number;
	clientY: number;
}

const UNZOOMED = {scale: 1, idealTx: 0, idealTy: 0};

export function clampPan(value: number, limit: number): number {
	return Math.min(limit, Math.max(-limit, value));
}

function travel(size: number, viewport: number): number {
	return Math.max(0, (size + viewport) / 2 - Math.min(size, viewport * PAN_LIMIT_FRACTION));
}

function panLimit(fit: number, viewport: number, scale: number): number {
	const ramp = Math.min(1, Math.max(0, (scale - SNAP_TO_FIT) / 0.95));
	return travel(fit * scale, viewport) * ramp;
}

export function zoomTransform(zoom: ZoomState): string {
	return `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
}

/** The fitted image's geometry, or null while it animates or has no layout. */
export function measureZoom(img: HTMLImageElement, stage: HTMLElement | null): ZoomGeometry | null {
	// jsdom and older engines have no Web Animations API.
	const animating =
		"getAnimations" in img && img.getAnimations().some((animation) => animation.playState === "running");
	if (animating) return null;
	const fit = img.getBoundingClientRect();
	const viewport = stage?.getBoundingClientRect();
	if (viewport === undefined || fit.width === 0 || fit.height === 0) return null;
	return {
		fitWidth: fit.width,
		fitHeight: fit.height,
		fitCenterX: fit.left + fit.width / 2,
		fitCenterY: fit.top + fit.height / 2,
		maxScale: Math.max(img.naturalWidth / fit.width, MIN_MAX_SCALE),
		viewportWidth: viewport.width,
		viewportHeight: viewport.height,
	};
}

/** Zoom from `previous` to `scale`, keeping `point` (or the centre) fixed under the cursor. */
function zoomAt(
	geometry: ZoomGeometry,
	previous: {scale: number; idealTx: number; idealTy: number},
	scale: number,
	point: Point | null,
): ZoomState {
	const maxTx = panLimit(geometry.fitWidth, geometry.viewportWidth, scale);
	const maxTy = panLimit(geometry.fitHeight, geometry.viewportHeight, scale);
	const offsetX = point === null ? 0 : point.clientX - geometry.fitCenterX;
	const offsetY = point === null ? 0 : point.clientY - geometry.fitCenterY;
	const ratio = scale / previous.scale;
	const idealX = offsetX - (offsetX - previous.idealTx) * ratio;
	const idealY = offsetY - (offsetY - previous.idealTy) * ratio;
	const tx = clampPan(idealX, maxTx);
	const ty = clampPan(idealY, maxTy);
	const previousMaxTx = panLimit(geometry.fitWidth, geometry.viewportWidth, previous.scale);
	const previousMaxTy = panLimit(geometry.fitHeight, geometry.viewportHeight, previous.scale);
	return {
		...geometry,
		scale,
		idealTx: maxTx < previousMaxTx ? tx : idealX,
		idealTy: maxTy < previousMaxTy ? ty : idealY,
		tx,
		ty,
		maxTx,
		maxTy,
	};
}

/** The click/Enter toggle target: the image at its natural size (at least 2x), anchored at `point`. */
export function fitZoom(img: HTMLImageElement, stage: HTMLElement | null, point: Point | null): ZoomState | null {
	const geometry = measureZoom(img, stage);
	if (geometry === null) return null;
	const zoom = zoomAt(geometry, UNZOOMED, geometry.maxScale, point);
	const tx = clampPan(zoom.tx, Math.max(0, (geometry.fitWidth * geometry.maxScale - geometry.viewportWidth) / 2));
	const ty = clampPan(zoom.ty, Math.max(0, (geometry.fitHeight * geometry.maxScale - geometry.viewportHeight) / 2));
	return {...zoom, tx, ty, idealTx: tx, idealTy: ty};
}

/** The next state for a ctrl+wheel (trackpad pinch) step, or null to snap back to fit. */
export function pinchZoom(
	zoom: ZoomState | null,
	geometry: ZoomGeometry | null,
	factor: number,
	point: Point,
): ZoomState | null {
	const base = zoom ?? geometry;
	if (base === null) return zoom;
	const previous = zoom ?? UNZOOMED;
	const scale = Math.min(Math.max(previous.scale * factor, 1), base.maxScale);
	if (zoom === null && scale === 1) return zoom;
	const next = zoom === null ? Math.min(Math.max(scale, MIN_FIRST_STEP), base.maxScale) : scale;
	if (factor < 1 && next <= SNAP_TO_FIT) return null;
	if (next === zoom?.scale) return zoom;
	return zoomAt(base, previous, next, point);
}
