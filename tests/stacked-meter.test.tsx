// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	StackedMeter,
	StackedMeterGroup,
	StackedMeterSwatch,
	type StackedMeterCategory,
} from "../src/components/ui/stacked-meter";
import {Tooltip, TooltipGroup} from "../src/components/ui/tooltip";

const AB: StackedMeterCategory[] = [
	{
		id: "a",
		label: "A",
	},
	{
		id: "b",
		label: "B",
	},
];

class FakeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function meter(container: HTMLElement): HTMLElement
{
	const found = container.querySelector<HTMLElement>('[data-cds="StackedMeter"]');
	if (found === null) throw new Error("no meter");
	return found;
}

function tooltips(): string[]
{
	return screen.queryAllByRole("tooltip").map((tip) => tip.textContent);
}

function hover(element: Element)
{
	fireEvent.pointerEnter(element);
	act(() =>
	{
		vi.advanceTimersByTime(300);
	});
}

describe("StackedMeter (sm/md)", () =>
{
	it("reads its rows aloud at size sm when it has a readout", () =>
	{
		const {container} = render(
			<StackedMeterGroup categories={AB} size="sm" formatValue={String}>
				<StackedMeter
					values={
					{
						a: 10,
						b: 10,
					}}
					total={20}
					readout
					label="Context window"
				/>
			</StackedMeterGroup>,
		);
		const root = meter(container);
		expect(
			{
				size: root.getAttribute("data-size"),
				role: root.getAttribute("role"),
				tabIndex: root.getAttribute("tabindex"),
				label: root.getAttribute("aria-label"),
				className: root.className,
				style: root.getAttribute("style"),
			},
		).toStrictEqual(
			{
				size: "sm",
				role: "img",
				tabIndex: "0",
				label: "Context window: A: 10, 50%; B: 10, 50%",
				className:
					"relative w-full overflow-hidden forced-colors:outline forced-colors:outline-solid forced-colors:outline-[color:CanvasText] rounded-full outline-none focus-visible:outline-hidden focus-visible:shadow-focus",
				style: "background-color: var(--chart-reference-tint); container-type: inline-size; height: 4px;",
			},
		);
	});

	it("is 8px thick with no data-size at the default size, and labels rows without a heading", () =>
	{
		const {container} = render(
			<StackedMeterGroup categories={AB}>
				<StackedMeter
					values={
					{
						a: 1,
						b: 3,
					}}
					readout
				/>
			</StackedMeterGroup>,
		);
		const root = meter(container);
		expect(
			{
				size: root.getAttribute("data-size"),
				label: root.getAttribute("aria-label"),
				style: root.getAttribute("style"),
			},
		).toStrictEqual(
			{
				size: null,
				label: "A: 1, 25%; B: 3, 75%",
				style: "container-type: inline-size; height: 8px;",
			},
		);
	});

	it("is hidden from assistive tech, unfocusable and tipless without a readout", () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		const {container} = render(
			<StackedMeterGroup categories={AB} size="sm">
				<StackedMeter
					values={
					{
						a: 10,
						b: 10,
					}}
					total={20}
				/>
			</StackedMeterGroup>,
		);
		const root = meter(container);
		hover(root);
		hover(root.firstElementChild!);
		expect(
			{
				hidden: root.getAttribute("aria-hidden"),
				role: root.getAttribute("role"),
				tabIndex: root.getAttribute("tabindex"),
				tips: tooltips(),
			},
		).toStrictEqual(
			{
				hidden: "true",
				role: null,
				tabIndex: null,
				tips: [],
			},
		);
	});

	it("keeps the forced-colors outline and tint for an empty meter only when it has a total", () =>
	{
		const {container} = render(
			<StackedMeterGroup categories={AB} size="sm">
				<StackedMeter
					values={
					{
						a: 0,
						b: 0,
					}}
					total={20}
				/>
				<StackedMeter
					values={
					{
						a: 0,
						b: 0,
					}}
				/>
			</StackedMeterGroup>,
		);
		expect(
			[...container.querySelectorAll('[data-cds="StackedMeter"]')].map((root) => [
				root.className,
				root.getAttribute("style"),
				root.children.length,
			]),
		).toStrictEqual([
			[
				"relative w-full overflow-hidden forced-colors:outline forced-colors:outline-solid forced-colors:outline-[color:CanvasText] rounded-full",
				"background-color: var(--chart-reference-tint); container-type: inline-size; height: 4px;",
				0,
			],
			["relative w-full overflow-hidden rounded-full", "container-type: inline-size; height: 4px;", 0],
		]);
	});

	it("throws outside a StackedMeterGroup", () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<StackedMeter values={{}} />)).toThrow(
			"<StackedMeter> must be rendered inside a <StackedMeterGroup>, which declares its categories.",
		);
	});

	it("paints uncoloured categories categorical-1 to 5 and explicit ones in their own colour", () =>
	{
		const categories: StackedMeterCategory[] = [
			...["a", "b", "c", "d", "e"].map((id) => (
			{
				id,
				label: id.toUpperCase(),
			})),
			{
				id: "f",
				label: "F",
				color: "muted",
			},
		];
		const {container} = render(
			<StackedMeterGroup categories={categories} size="sm">
				<StackedMeter
					values={
					{
						a: 10,
						b: 10,
						c: 10,
						d: 10,
						e: 10,
						f: 10,
					}}
					readout
				/>
			</StackedMeterGroup>,
		);
		expect(
			[...meter(container).children].map(
				(segment) => (segment.firstElementChild as HTMLElement | null)?.style.backgroundColor,
			),
		).toStrictEqual([
			"var(--chart-categorical-1)",
			"var(--chart-categorical-2)",
			"var(--chart-categorical-3)",
			"var(--chart-categorical-4)",
			"var(--chart-categorical-5)",
			"var(--chart-muted)",
		]);
	});

	it("lays out at upstream's 640px before it is measured", () =>
	{
		// 0.007 of 640px is 4.48px, a segment; at 246px it would be 1.72px, narrower than the 4px meter, so a dot.
		const {container} = render(
			<StackedMeterGroup
				categories={[
					{
						id: "a",
						label: "A",
					},
				]}
				size="sm"
			>
				<StackedMeter
					values={
					{
						a: 7,
					}}
					total={1000}
					readout
				/>
			</StackedMeterGroup>,
		);
		expect(meter(container).firstElementChild?.getAttribute("style")).toBe(
			"inset-inline-start: calc(0% + 0px); width: calc(0.7% - 0px);",
		);
	});
});

describe("StackedMeter tooltips", () =>
{
	function Meter({children}: {children?: ReactNode})
	{
		return (
			<StackedMeterGroup categories={AB} size="sm" formatValue={String}>
				<StackedMeter
					values={
					{
						a: 10,
						b: 10,
					}}
					total={20}
					readout
					label="Usage"
				/>
				{children}
			</StackedMeterGroup>
		);
	}

	it("shares an enclosing TooltipGroup, so a sibling's tip replaces the meter's", () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		const {container} = render(
			<TooltipGroup>
				<Meter>
					<Tooltip content="Sibling">
						<button type="button">sibling</button>
					</Tooltip>
				</Meter>
			</TooltipGroup>,
		);
		fireEvent.focus(meter(container));
		const meterTips = tooltips();
		fireEvent.focus(screen.getByRole("button"));
		expect(
			{
				meterTips,
				after: tooltips(),
			},
		).toStrictEqual(
			{
				meterTips: ["A: 10, 50%\nB: 10, 50%"],
				after: ["Sibling"],
			},
		);
	});

	it("closes a segment's tip 200ms after the pointer leaves it in its own group", () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		const {container} = render(<Meter />);
		const segment = meter(container).firstElementChild!;
		hover(segment);
		const open = tooltips();
		fireEvent.pointerLeave(segment);
		act(() =>
		{
			vi.advanceTimersByTime(200);
		});
		expect(
			{
				open,
				closed: tooltips(),
			},
		).toStrictEqual(
			{
				open: ["A: 10, 50%"],
				closed: [],
			},
		);
	});

	it("isolates each part of a line in bdi under rtl", () =>
	{
		const {container} = render(
			<div dir="rtl">
				<Meter />
			</div>,
		);
		fireEvent.focus(meter(container));
		const tip = screen.getByRole("tooltip");
		expect(
			{
				bdi: [...tip.querySelectorAll("bdi")].map((bdi) => bdi.textContent),
				text: tip.textContent,
			},
		).toStrictEqual(
			{
				bdi: ["A", "10", "50%", "B", "10", "50%"],
				text: "A: 10, 50%\nB: 10, 50%",
			},
		);
	});

	it("isolates the parts of a line whose label is right-to-left text", () =>
	{
		const {container} = render(
			<StackedMeterGroup
				categories={[
					{
						id: "a",
						label: "שלום",
					},
				]}
				size="sm"
				formatValue={String}
			>
				<StackedMeter
					values={
					{
						a: 10,
					}}
					total={20}
					readout
				/>
			</StackedMeterGroup>,
		);
		fireEvent.focus(meter(container));
		expect([...screen.getByRole("tooltip").querySelectorAll("bdi")].map((bdi) => bdi.textContent)).toStrictEqual([
			"שלום",
			"10",
			"50%",
		]);
	});
});

describe("StackedMeter lg", () =>
{
	it("draws 2px-apart blocks with printed shares and a rest track", () =>
	{
		const categories: StackedMeterCategory[] = [
			{
				id: "a",
				label: "A",
			},
			{
				id: "b",
				label: "B",
			},
			{
				id: "c",
				label: "C",
				color: "categorical-4",
			},
		];
		const {container} = render(
			<StackedMeterGroup categories={categories} size="lg" valueLabels="share">
				<StackedMeter
					values={
					{
						a: 50,
						b: 20,
						c: 10,
					}}
					total={100}
				/>
			</StackedMeterGroup>,
		);
		const root = meter(container);
		const run = root.firstElementChild as HTMLElement;
		expect(
			{
				size: root.getAttribute("data-size"),
				className: root.className,
				style: root.getAttribute("style"),
				run: run.getAttribute("style"),
				blocks: [...run.children].map((block) => (
				{
					category: block.getAttribute("data-category"),
					className: block.className,
					paint: (block as HTMLElement).style.backgroundColor,
					label: block.lastElementChild?.className,
					text: block.textContent,
				})),
				rest: root.lastElementChild?.getAttribute("style"),
			},
		).toStrictEqual(
			{
				size: null,
				// Printed values give the meter rows, so it reads them aloud and takes the readout's touch and focus classes.
				className:
					"relative w-full overflow-hidden forced-colors:outline forced-colors:outline-solid forced-colors:outline-[color:CanvasText] flex touch-pan-y touch-pinch-zoom outline-none focus-visible:outline-hidden focus-visible:shadow-focus",
				style: "border-radius: 4px; gap: 2px; container-type: inline-size; height: 28px;",
				run: "width: 80%; min-width: 4px; gap: 2px;",
				blocks: [
					["a", "var(--chart-categorical-1)", "text-gray-0", "50%"],
					["b", "var(--chart-categorical-2)", "text-gray-0", "20%"],
					["c", "var(--chart-categorical-4)", "text-neutral-900", "10%"],
				].map(([category, paint, ink, text]) => (
				{
					category,
					className: "flex min-w-0 flex-wrap items-center overflow-clip forced-color-adjust-none",
					paint,
					label: `text-caption font-semibold tabular-nums px-sm whitespace-nowrap select-none ${ink}`,
					text,
				})),
				rest: "background-color: var(--chart-reference-tint); border-radius: 4px;",
			},
		);
	});

	it("prints amounts compact from 10,000 with valueLabels amount", () =>
	{
		const {container} = render(
			<StackedMeterGroup categories={AB} size="lg" valueLabels="amount">
				<StackedMeter
					values={
					{
						a: 12_345,
						b: 9_999,
					}}
				/>
			</StackedMeterGroup>,
		);
		expect([...container.querySelectorAll("[data-category]")].map((block) => block.textContent)).toStrictEqual([
			"12.3K",
			"9,999",
		]);
	});
});

describe("StackedMeterSwatch", () =>
{
	it("paints a visible series and draws nothing for hidden or unknown ones", () =>
	{
		const {container} = render(
			<StackedMeterGroup
				categories={[
					...AB,
					{
						id: "h",
						label: "H",
						hidden: true,
					},
				]}
			>
				<StackedMeterSwatch series="b" />
				<StackedMeterSwatch series="h" />
				<StackedMeterSwatch series="nope" />
			</StackedMeterGroup>,
		);
		expect([...container.children].map((swatch) => [swatch.outerHTML])).toStrictEqual([
			[
				'<span aria-hidden="true" class="shrink-0 forced-color-adjust-none" style="width: 10px; height: 10px; border-radius: 2px; background: var(--chart-categorical-2); display: inline-block;"></span>',
			],
		]);
	});
});
