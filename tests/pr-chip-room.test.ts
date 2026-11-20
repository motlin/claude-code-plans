import {describe, expect, it} from "vite-plus/test";

import {compileAll} from "./helpers/tailwind-design-system";
import
{
	CHIP_ROOM_CLASS,
	type ChipRoom,
	type ChipRoomMeasure,
	nextChipRoom,
} from "../src/components/changes/pr-chip-room";

/** The live sweep's numbers (16px root, parts 42, number link 56, short link 28), with a 260px row. */
function measure(state: ChipRoom, free: number, overrides: Partial<ChipRoomMeasure> = {}): ChipRoomMeasure
{
	return {
		rowWidth: 260,
		leadWidth: 260 - free,
		scopeLabelWidth: 197,
		rootFontSize: 16,
		linkWidth: state === "number" ? 56 : 28,
		partsWidth: 42,
		numberLinkWidth: 56,
		afterBadge: false,
		...overrides,
	};
}

// Upstream `PC`: the chip shrinks number → short → none, and grows back with an 8px margin.
describe("nextChipRoom", () =>
{
	it("ports upstream's fit steps from the live sweep", () =>
	{
		const step = (state: ChipRoom, free: number, grown: boolean, overrides: Partial<ChipRoomMeasure> = {}) =>
			nextChipRoom(state, measure(state, free, overrides), grown).state;
		expect(
			{
				tightNumber: step("number", 1, false),
				shortAtFloor: step(
					"short",
					0,
					false,
					{
						scopeLabelWidth: 128,
					},
				),
				shortAboveFloor: step(
					"short",
					0,
					false,
					{
						scopeLabelWidth: 138,
					},
				),
				noneGivesRoom: step(
					"none",
					0,
					true,
					{
						scopeLabelWidth: 180,
					},
				),
				noneShort: step(
					"none",
					0,
					true,
					{
						scopeLabelWidth: 170,
					},
				),
				shortGrows: step("short", 37, true),
				shortAtMargin: step("short", 36, true),
				shortNotGrown: step("short", 100, false),
				afterBadge: step(
					"number",
					50,
					false,
					{
						scopeLabelWidth: 120,
						afterBadge: true,
					},
				),
				hiddenRow: step(
					"short",
					0,
					true,
					{
						rowWidth: 0,
						leadWidth: 0,
					},
				),
			},
		).toEqual(
			{
				tightNumber: "short",
				shortAtFloor: "none",
				shortAboveFloor: "short",
				noneGivesRoom: "short",
				noneShort: "none",
				shortGrows: "number",
				shortAtMargin: "short",
				shortNotGrown: "short",
				afterBadge: "short",
				hiddenRow: "short",
			},
		);
	});

	it("remembers the number link's width only while showing the number", () =>
	{
		expect(
			{
				number: nextChipRoom(
					"number",
					measure(
						"number",
						100,
						{
							linkWidth: 60,
						},
					),
					false,
				),
				short: nextChipRoom(
					"short",
					measure(
						"short",
						0,
						{
							numberLinkWidth: 60,
						},
					),
					false,
				),
			},
		).toEqual(
			{
				number:
				{
					state: "number",
					numberLinkWidth: 60,
				},
				short:
				{
					state: "short",
					numberLinkWidth: 60,
				},
			},
		);
	});
});

describe("chip room classes", () =>
{
	// Tailwind v4 must emit the reveal variants and the 3rem row gap that pushes the wrapped parts out of sight.
	it("compiles the none-state collapse and its focus and popup reveals", async () =>
	{
		const css = await compileAll([
			"w-0",
			"gap-y-12",
			"overflow-y-clip",
			"has-[:focus-visible]:w-auto",
			"has-[:focus-visible]:overflow-y-visible",
			"has-[[data-popup-open]]:w-auto",
		]);

		expect(
			{
				classes: CHIP_ROOM_CLASS.split(" "),
				css,
			},
		).toEqual(
			{
				classes: expect.arrayContaining([
					"gap-y-12",
					"overflow-y-clip",
					"has-[:focus-visible]:w-auto",
					"has-[:focus-visible]:overflow-y-visible",
					"has-[[data-popup-open]]:w-auto",
				]),
				css:
				{
					"w-0": ".w-0 { width: 0px; }",
					"gap-y-12": ".gap-y-12 { row-gap: calc(var(--spacing) * 12); }",
					"overflow-y-clip": ".overflow-y-clip { overflow-y: clip; }",
					"has-[:focus-visible]:w-auto":
						".has-\\[\\:focus-visible\\]\\:w-auto:has(:is(:focus-visible)) { width: auto; }",
					"has-[:focus-visible]:overflow-y-visible":
						".has-\\[\\:focus-visible\\]\\:overflow-y-visible:has(:is(:focus-visible)) { overflow-y: visible; }",
					"has-[[data-popup-open]]:w-auto":
						".has-\\[\\[data-popup-open\\]\\]\\:w-auto:has(:is([data-popup-open])) { width: auto; }",
				},
			},
		);
	});
});
