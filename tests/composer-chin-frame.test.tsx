// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ComposerChinFrame} from "../src/components/composer-chin-frame";
import
{
	CHIN_BUTTON_CLASS,
	COMPOSER_CHIN_FRAME_CLASS,
	COMPOSER_CHIN_GRID_CLASS,
	COMPOSER_CHIN_ROW_CLASS,
	COMPOSER_CHIN_SLIDE_CLASS,
	COMPOSER_CHIN_TRAILING_CLASS,
} from "../src/components/composer-tokens";

afterEach(cleanup);

/** The frame's four nested boxes, as upstream's rp renders them. */
function frameParts()
{
	const chin = document.querySelector<HTMLElement>('[data-cds="ChatComposerChin"]')!;
	const grid = chin.firstElementChild as HTMLElement;
	const slide = grid.firstElementChild as HTMLElement;
	const row = slide.firstElementChild as HTMLElement;
	return {
		chin,
		grid,
		slide,
		row,
	};
}

describe("ComposerChinFrame", () =>
{
	it("renders upstream's open chin: aria-hidden false, a 1fr grid row and a resting slide, at the 280ms ease-out", () =>
	{
		render(<ComposerChinFrame trailing={<button type="button">Mode</button>} />);
		const {chin, grid, slide, row} = frameParts();

		expect(
			{
				chinAria: chin.getAttribute("aria-hidden"),
				chinClass: chin.className,
				gridClass: grid.className,
				slideClass: slide.className,
				slideInert: slide.hasAttribute("inert"),
				row: [
					row.getAttribute("data-size"),
					row.getAttribute("data-touch-size"),
					row.hasAttribute("data-chin-row"),
				],
			},
		).toStrictEqual(
			{
				chinAria: "false",
				chinClass: COMPOSER_CHIN_FRAME_CLASS,
				gridClass:
					"grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-[280ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none grid-rows-[1fr]",
				slideClass:
					"min-h-0 transition-[opacity,translate] duration-[280ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none translate-none opacity-100",
				slideInert: false,
				row: ["xs", "", true],
			},
		);
	});

	it("collapses like upstream when closed: aria-hidden true, a 0fr grid row, a raised transparent inert slide, and its buttons leave the accessibility tree", () =>
	{
		render(<ComposerChinFrame open={false} trailing={<button type="button">Mode</button>} />);
		const {chin, grid, slide} = frameParts();

		expect(
			{
				chinAria: chin.getAttribute("aria-hidden"),
				gridClass: grid.className,
				slideClass: slide.className,
				slideInert: slide.hasAttribute("inert"),
				buttons: screen.queryAllByRole("button").length,
			},
		).toStrictEqual(
			{
				chinAria: "true",
				gridClass: `${COMPOSER_CHIN_GRID_CLASS} grid-rows-[0fr]`,
				slideClass: `${COMPOSER_CHIN_SLIDE_CLASS} -translate-y-2 opacity-0`,
				slideInert: true,
				buttons: 0,
			},
		);
	});

	it("spreads leading and trailing slots apart, centres an empty row, and gives a leading-less row upstream's narrow-container pads", () =>
	{
		const rows = (
			[
				[
					"both",
					<span key="leading" aria-hidden="true" />,
					<button key="trailing" type="button">
						Mode
					</button>,
				],
				[
					"trailing only",
					undefined,
					<button key="trailing" type="button">
						Mode
					</button>,
				],
				["empty", undefined, undefined],
			] as const
		).map(([name, leading, trailing]) =>
		{
			const {unmount} = render(<ComposerChinFrame leading={leading} trailing={trailing} />);
			const {row} = frameParts();
			const result =
			{
				name,
				row: row.className.replace(COMPOSER_CHIN_ROW_CLASS, "<row>"),
				slots: Array.from(row.children, (child) => (
				{
					className: child.className,
					part: child.getAttribute("data-cds-part"),
				})),
			};
			unmount();
			return result;
		});

		expect(rows).toStrictEqual([
			{
				name: "both",
				row: "<row> justify-between",
				slots: [
					{
						className: "flex items-center self-start",
						part: null,
					},
					{
						className:
							"ms-auto flex min-w-0 items-center gap-1 ps-2 [--upstream-text-body:calc(0.8125rem*var(--cds-rem-scale,1))] [--upstream-leading-body:calc(1.25rem*var(--cds-rem-scale,1))]",
						part: "chin-trailing",
					},
				],
			},
			{
				name: "trailing only",
				row: "<row> @max-[24rem]:px-0 justify-between",
				slots: [
					{
						className:
							"ms-auto flex min-w-0 items-center gap-1 ps-2 [--upstream-text-body:calc(0.8125rem*var(--cds-rem-scale,1))] [--upstream-leading-body:calc(1.25rem*var(--cds-rem-scale,1))] @max-[24rem]:ps-0 @max-[24rem]:[&_:is([data-cds=Button],[data-cds=ModelSelector])]:px-1",
						part: "chin-trailing",
					},
				],
			},
			{
				name: "empty",
				row: "<row> @max-[24rem]:px-0 justify-center",
				slots: [],
			},
		]);
	});

	it("gives the xs row upstream's flat 8px margin and narrow caption, and inherits upstream's 13px/17px regular-weight footnote, and sets the 13px/20px body on the trailing wrapper (upstream `my`) its text-body chin buttons read", () =>
	{
		const vars = [
			"[--upstream-text-body:calc(0.8125rem*var(--cds-rem-scale,1))]",
			"[--upstream-leading-body:calc(1.25rem*var(--cds-rem-scale,1))]",
		];
		const row = COMPOSER_CHIN_ROW_CLASS.split(" ");
		const trailing = COMPOSER_CHIN_TRAILING_CLASS.split(" ");
		const button = CHIN_BUTTON_CLASS.split(" ");

		expect(
			{
				rowHas: [
					"mt-2",
					"mt-1.5",
					"comfortable:mt-2",
					"@max-[25rem]:text-caption",
					"[--cmp-chin-row-h:1.5rem]",
					"text-footnote",
					"font-normal",
					"text-body",
					...vars,
					"[--cmp-chin-start:8px]",
					"[--cmp-chin-start:7px]",
				].map((name) => row.includes(name)),
				trailingHas: vars.map((name) => trailing.includes(name)),
				buttonHas: ["text-body"].map((name) => button.includes(name)),
			},
		).toStrictEqual(
			{
				rowHas: [true, false, false, true, true, true, true, false, false, false, true, false],
				trailingHas: [true, true],
				buttonHas: [true],
			},
		);
	});
});
