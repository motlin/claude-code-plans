import { describe, expect, it } from "vite-plus/test";
import { shouldClose, shouldStartDrag, swipeIntent } from "../src/lib/sheet-swipe";

describe("shouldStartDrag", () => {
  it.each([
    { dx: 0, dy: 0, expected: false },
    { dx: 9, dy: 0, expected: false },
    { dx: 10, dy: 0, expected: true },
    { dx: 10, dy: 9, expected: true },
    { dx: 10, dy: -9, expected: true },
    { dx: 10, dy: 10, expected: false },
    { dx: 12, dy: 30, expected: false },
    { dx: -10, dy: 0, expected: false },
    { dx: -40, dy: 2, expected: false },
    { dx: 0, dy: 20, expected: false },
    { dx: 50, dy: 49, expected: true },
  ])("dx=$dx dy=$dy -> $expected", ({ dx, dy, expected }) => {
    expect(shouldStartDrag(dx, dy)).toBe(expected);
  });
});

describe("swipeIntent", () => {
  it.each([
    { dx: 0, dy: 0, expected: "pending" },
    { dx: 9, dy: 9, expected: "pending" },
    { dx: -9, dy: 0, expected: "pending" },
    { dx: 10, dy: 0, expected: "drag" },
    { dx: -10, dy: 0, expected: "abandon" },
    { dx: 3, dy: 10, expected: "abandon" },
  ] as const)("dx=$dx dy=$dy -> $expected", ({ dx, dy, expected }) => {
    expect(swipeIntent(dx, dy)).toBe(expected);
  });
});

describe("shouldClose", () => {
  it.each([
    { distance: 0, width: 390, velocity: 0, expected: false },
    { distance: 130, width: 390, velocity: 0.1, expected: false },
    { distance: 131, width: 390, velocity: 0.1, expected: true },
    { distance: 40, width: 390, velocity: 0.5, expected: false },
    { distance: 40, width: 390, velocity: 0.51, expected: true },
    { distance: 300, width: 390, velocity: 0, expected: true },
    { distance: 200, width: 639, velocity: 0.2, expected: false },
    { distance: 214, width: 639, velocity: 0.2, expected: true },
  ])(
    "distance=$distance width=$width velocity=$velocity -> $expected",
    ({ distance, width, velocity, expected }) => {
      expect(shouldClose(distance, width, velocity)).toBe(expected);
    },
  );
});
