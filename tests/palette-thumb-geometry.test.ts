import {describe, expect, it} from "vite-plus/test";
import {cardFromThumbOffset, thumbCardPlacement} from "../src/components/palette-thumb-geometry";

// Upstream's live 1272×750 measure: the dialog at 300,83 672×583, the selected row at y 231.
const live =
{
	dialog:
	{
		x: 300,
		y: 83,
		width: 672,
		height: 583,
	},
	list:
	{
		x: 300,
		y: 160,
		width: 672,
		height: 400,
	},
	row:
	{
		y: 231,
		height: 36,
	},
	viewport:
	{
		width: 1272,
		height: 750,
	},
	cardHeight: 205,
	dir: "ltr",
} as const;

describe("thumbCardPlacement", () =>
{
	it("sits 12px past the dialog, clamped to the 16px viewport gutter, at the row's y", () =>
	{
		expect(thumbCardPlacement(live)).toStrictEqual(
			{
				x: 976,
				y: 231,
				top: 148,
				left: 4,
			},
		);
	});

	it("shows no card when it would cross the dialog's centre", () =>
	{
		expect(
			thumbCardPlacement(
				{
					...live,
					viewport:
					{
						width: 900,
						height: 750,
					},
				},
			),
		).toBeNull();
	});

	it("keeps a row below the fold's card 16px above the viewport bottom", () =>
	{
		expect(
			thumbCardPlacement(
				{
					...live,
					list:
					{
						...live.list,
						height: 560,
					},
					row:
					{
						y: 700,
						height: 36,
					},
				},
			),
		).toStrictEqual(
			{
				x: 976,
				y: 529,
				top: 446,
				left: 4,
			},
		);
	});

	it("mirrors to the dialog's left in RTL", () =>
	{
		expect(
			thumbCardPlacement(
				{
					...live,
					dir: "rtl",
				},
			),
		).toStrictEqual(
			{
				x: 16,
				y: 231,
				top: 148,
				left: -956,
			},
		);
		expect(
			thumbCardPlacement(
				{
					...live,
					dialog:
					{
						...live.dialog,
						x: 50,
						width: 400,
					},
					dir: "rtl",
				},
			),
		).toBeNull();
	});
});

describe("cardFromThumbOffset", () =>
{
	const fixture =
	{
		dialog:
		{
			x: 100,
			y: 150,
			width: 600,
			height: 500,
		},
		list:
		{
			x: 100,
			y: 200,
			width: 600,
			height: 400,
		},
		row:
		{
			y: 300,
			height: 32,
		},
		viewport:
		{
			width: 1100,
			height: 800,
		},
		cardHeight: 205,
		dir: "ltr",
		reducedMotion: false,
	} as const;

	it("is the thumb card's offset from the row-actions card's spot over the receded palette", () =>
	{
		// Anchor 109,299 582 wide (right 691): the card sits at 691 - 44 = 647, the thumb at 712,300.
		expect(cardFromThumbOffset(fixture)).toStrictEqual(
			{
				x: 65,
				y: 1,
			},
		);
	});

	it("clamps the card to upstream's 5px viewport edge", () =>
	{
		expect(
			cardFromThumbOffset(
				{
					...fixture,
					viewport:
					{
						width: 900,
						height: 800,
					},
				},
			),
		).toStrictEqual(
			{
				// The thumb clamps to 900 - 16 - 280 = 604 and the card to 900 - 5 - 280 = 615.
				x: -11,
				y: 1,
			},
		);
	});

	it("is null whenever the thumb card has no room", () =>
	{
		expect(
			cardFromThumbOffset(
				{
					...fixture,
					viewport:
					{
						width: 650,
						height: 800,
					},
				},
			),
		).toBeNull();
	});
});
