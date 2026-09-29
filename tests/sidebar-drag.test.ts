import { describe, expect, it } from "vite-plus/test";

import {
  DRAG_THRESHOLD_PX,
  autoScrollDelta,
  computeMidpoints,
  exceedsDragThreshold,
  shiftFor,
  slotFromPointer,
  slotToIndex,
} from "../src/lib/sidebar-drag";

const rects = [
  { top: 0, height: 20 },
  { top: 21, height: 20 },
  { top: 42, height: 20 },
  { top: 63, height: 20 },
];

describe("computeMidpoints", () => {
  it("returns the vertical centre of each rect", () => {
    expect(computeMidpoints(rects)).toStrictEqual([10, 31, 52, 73]);
  });

  it("returns an empty list for no rows", () => {
    expect(computeMidpoints([])).toStrictEqual([]);
  });
});

describe("exceedsDragThreshold", () => {
  it("uses the upstream 4px threshold", () => {
    expect({
      threshold: DRAG_THRESHOLD_PX,
      still: exceedsDragThreshold(0, 0),
      atThreshold: exceedsDragThreshold(4, 0),
      diagonalUnder: exceedsDragThreshold(2, 3),
      diagonalOver: exceedsDragThreshold(3, 3),
      vertical: exceedsDragThreshold(0, -5),
    }).toStrictEqual({
      threshold: 4,
      still: false,
      atThreshold: false,
      diagonalUnder: false,
      diagonalOver: true,
      vertical: true,
    });
  });
});

describe("slotFromPointer", () => {
  const midpoints = computeMidpoints(rects);

  it("counts the midpoints above the pointer for an external source", () => {
    expect([-5, 9, 11, 40, 60, 100].map((y) => slotFromPointer(midpoints, y, null))).toStrictEqual([
      0, 0, 1, 2, 3, 4,
    ]);
  });

  it("returns slot 0 for an empty list", () => {
    expect(slotFromPointer([], 50, null)).toBe(0);
  });

  it("treats the source's own slot and the slot after it as a no-op", () => {
    expect([5, 20, 40, 60, 100].map((y) => slotFromPointer(midpoints, y, 1))).toStrictEqual([
      0,
      null,
      null,
      3,
      4,
    ]);
  });

  it("treats the first and last slots as no-ops for the edge rows", () => {
    expect({
      first: slotFromPointer(midpoints, 0, 0),
      firstBelow: slotFromPointer(midpoints, 20, 0),
      last: slotFromPointer(midpoints, 100, 3),
      lastAbove: slotFromPointer(midpoints, 40, 3),
    }).toStrictEqual({ first: null, firstBelow: null, last: null, lastAbove: 2 });
  });
});

describe("slotToIndex", () => {
  it("maps an insertion slot to the final index of the moved row", () => {
    expect({
      external: slotToIndex(2, null),
      movingUp: slotToIndex(0, 2),
      movingDown: slotToIndex(4, 1),
    }).toStrictEqual({ external: 2, movingUp: 0, movingDown: 3 });
  });
});

describe("shiftFor", () => {
  const shifts = (srcIdx: number | null, slot: number | null) =>
    [0, 1, 2, 3].map((index) => shiftFor(index, srcIdx, slot, 21));

  it("pushes rows at and below the slot down for an external source", () => {
    expect(shifts(null, 2)).toStrictEqual([0, 0, 21, 21]);
  });

  it("does not shift anything without a slot", () => {
    expect({ external: shifts(null, null), internal: shifts(1, null) }).toStrictEqual({
      external: [0, 0, 0, 0],
      internal: [0, 0, 0, 0],
    });
  });

  it("pulls rows between the source and the slot up when moving down", () => {
    expect(shifts(0, 3)).toStrictEqual([0, -21, -21, 0]);
  });

  it("pushes rows between the slot and the source down when moving up", () => {
    expect(shifts(3, 1)).toStrictEqual([0, 21, 21, 0]);
  });
});

describe("autoScrollDelta", () => {
  const container = { top: 100, bottom: 500 };

  it("is zero away from the edges", () => {
    expect([200, 300, 436, 164].map((y) => autoScrollDelta(y, container))).toStrictEqual([
      0, 0, 0, 0,
    ]);
  });

  it("scrolls up near the top edge, faster the closer the pointer is", () => {
    expect([148, 132, 100, 50].map((y) => autoScrollDelta(y, container))).toStrictEqual([
      -4, -8, -16, -16,
    ]);
  });

  it("scrolls down near the bottom edge", () => {
    expect([452, 468, 500, 600].map((y) => autoScrollDelta(y, container))).toStrictEqual([
      4, 8, 16, 16,
    ]);
  });

  it("honours a custom edge size and speed", () => {
    expect(autoScrollDelta(110, container, { edge: 20, maxSpeed: 10 })).toBe(-5);
  });
});
