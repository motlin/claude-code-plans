import {describe, expect, it} from "vite-plus/test";
import {placeRowTooltip, placeTooltip} from "../src/components/ui/tooltip-placement";

const viewport = {width: 390, height: 800};

describe("placeTooltip", () => {
	it("keeps a tooltip that fits on its requested side unshifted", () => {
		expect(
			placeTooltip({left: 100, top: 100, width: 32, height: 32}, {width: 80, height: 24}, viewport, "top"),
		).toEqual({side: "top", shiftX: 0, shiftY: 0});
	});

	it("flips a top tooltip below a trigger at the top edge", () => {
		expect(
			placeTooltip({left: 100, top: 4, width: 32, height: 32}, {width: 80, height: 24}, viewport, "top"),
		).toEqual({
			side: "bottom",
			shiftX: 0,
			shiftY: 0,
		});
	});

	it("flips a bottom tooltip above a trigger at the bottom edge", () => {
		expect(
			placeTooltip({left: 100, top: 770, width: 32, height: 28}, {width: 80, height: 24}, viewport, "bottom"),
		).toEqual({side: "top", shiftX: 0, shiftY: 0});
	});

	it("shifts right to stay 8px inside the left edge", () => {
		// Centred under a 32px trigger at x=4, a 120px tooltip would start at x=-40.
		expect(
			placeTooltip({left: 4, top: 8, width: 32, height: 32}, {width: 120, height: 24}, viewport, "bottom"),
		).toEqual({
			side: "bottom",
			shiftX: 48,
			shiftY: 0,
		});
	});

	it("shifts left to stay 8px inside the right edge", () => {
		// Centred on x=330, a 127px tooltip would end at 393.5, past the 390 viewport.
		expect(
			placeTooltip({left: 314, top: 8, width: 32, height: 32}, {width: 127, height: 24}, viewport, "bottom"),
		).toEqual({side: "bottom", shiftX: -11.5, shiftY: 0});
	});

	it("flips a right tooltip to the left past the right edge and shifts it vertically inside the viewport", () => {
		expect(
			placeTooltip({left: 340, top: 2, width: 20, height: 20}, {width: 150, height: 40}, viewport, "right"),
		).toEqual({
			side: "left",
			shiftX: 0,
			shiftY: 16,
		});
	});
});

describe("placeTooltip align start", () => {
	const viewport = {width: 1024, height: 768};

	it("keeps a start-aligned tip at the trigger's left edge when it fits", () => {
		expect(
			placeTooltip(
				{left: 100, top: 100, width: 300, height: 32},
				{width: 104, height: 46},
				viewport,
				"top",
				"start",
			),
		).toEqual({side: "top", shiftX: 0, shiftY: 0});
	});

	it("shifts a start-aligned tip back inside the right edge from the trigger's left edge", () => {
		expect(
			placeTooltip(
				{left: 900, top: 100, width: 100, height: 32},
				{width: 200, height: 46},
				viewport,
				"top",
				"start",
			),
		).toEqual({side: "top", shiftX: -84, shiftY: 0});
	});
});

describe("placeRowTooltip", () => {
	it("anchors the tip 8px past the row's inline-end edge, level with the row, relative to the popup", () => {
		// A 240px popup at (100, 300) with 4px padding: the row spans x 104-336 and sits 28px into the popup.
		expect(
			placeRowTooltip(
				{left: 104, top: 328, width: 232, height: 24},
				{left: 100, top: 300, width: 240, height: 200},
			),
		).toEqual({left: 244, top: 28, maxWidth: "max(9rem, calc(100vw - 344px - 1rem))"});
	});

	it("follows the row's scrolled viewport position, so a row scrolled up sits above the popup top", () => {
		expect(
			placeRowTooltip({left: 4, top: -20, width: 232, height: 24}, {left: 0, top: 0, width: 240, height: 200}),
		).toEqual({left: 244, top: -20, maxWidth: "max(9rem, calc(100vw - 244px - 1rem))"});
	});
});
