/**
 * Pure geometry for the sidebar pointer-drag engine, ported from the claude.ai/code
 * sidebar (a bespoke pointer engine, no DnD library). The hook in
 * `src/hooks/use-sidebar-drag.ts` measures the DOM and feeds these helpers.
 */

/** Pointer travel (px) before a pointerdown becomes a drag; anything less is a click. */
export const DRAG_THRESHOLD_PX = 4;

export interface VerticalRect {
  readonly top: number;
  readonly height: number;
}

export interface VerticalBounds {
  readonly top: number;
  readonly bottom: number;
}

export interface AutoScrollOptions {
  /** Distance (px) from each edge where auto-scroll kicks in. */
  readonly edge?: number;
  /** Scroll step (px per frame) when the pointer is at or past the edge. */
  readonly maxSpeed?: number;
}

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
}

export function computeMidpoints(rects: readonly VerticalRect[]): number[] {
  return rects.map((rect) => rect.top + rect.height / 2);
}

/**
 * Insertion slot (0..n) for pointer `y` among rows with the given midpoints. When the
 * source row belongs to the list (`srcIdx`), dropping on its own slot or the one right
 * after it would not move it, so those return `null`.
 */
export function slotFromPointer(
  midpoints: readonly number[],
  y: number,
  srcIdx: number | null,
): number | null {
  const slot = midpoints.filter((midpoint) => midpoint < y).length;
  if (srcIdx !== null && (slot === srcIdx || slot === srcIdx + 1)) {
    return null;
  }
  return slot;
}

/** Final index of the dragged row after it is inserted at `slot`. */
export function slotToIndex(slot: number, srcIdx: number | null): number {
  return srcIdx !== null && slot > srcIdx ? slot - 1 : slot;
}

/** translateY (px) for row `index` so the list opens a gap at `slot`. */
export function shiftFor(
  index: number,
  srcIdx: number | null,
  slot: number | null,
  rowStep: number,
): number {
  if (slot === null || index === srcIdx) {
    return 0;
  }
  if (srcIdx === null) {
    return index >= slot ? rowStep : 0;
  }
  if (slot > srcIdx) {
    return index > srcIdx && index < slot ? -rowStep : 0;
  }
  return index >= slot && index < srcIdx ? rowStep : 0;
}

/** Per-frame scroll delta for a pointer near the top (negative) or bottom (positive) edge. */
export function autoScrollDelta(
  pointerY: number,
  container: VerticalBounds,
  { edge = 64, maxSpeed = 16 }: AutoScrollOptions = {},
): number {
  const intoTop = container.top + edge - pointerY;
  if (intoTop > 0) {
    return -Math.round(Math.min(1, intoTop / edge) * maxSpeed);
  }
  const intoBottom = pointerY - (container.bottom - edge);
  if (intoBottom > 0) {
    return Math.round(Math.min(1, intoBottom / edge) * maxSpeed);
  }
  return 0;
}
