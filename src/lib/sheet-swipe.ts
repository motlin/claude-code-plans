/**
 * Swipe-to-dismiss geometry for the phone sheet, decoded from claude.ai/code. Distances are
 * measured in the close direction: `dx` is positive when the finger travels left.
 */
const SWIPE_START_THRESHOLD_PX = 10;
const SWIPE_CLOSE_VELOCITY_PX_PER_MS = 0.5;

/** True once a leftward, mostly-horizontal drag has travelled at least 10px. */
export function shouldStartDrag(dx: number, dy: number): boolean {
  return dx >= SWIPE_START_THRESHOLD_PX && Math.abs(dy) < dx;
}

/** Keep waiting below the 10px threshold; past it, either follow the finger or give up. */
export function swipeIntent(dx: number, dy: number): "pending" | "drag" | "abandon" {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START_THRESHOLD_PX) return "pending";
  return shouldStartDrag(dx, dy) ? "drag" : "abandon";
}

/** A released drag closes past a third of the sheet width or faster than 0.5 px/ms. */
export function shouldClose(distance: number, width: number, velocity: number): boolean {
  return distance > width / 3 || velocity > SWIPE_CLOSE_VELOCITY_PX_PER_MS;
}
