// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {IndicatorSlot, Pulse} from "../src/components/ui/pulse";

afterEach(cleanup);

function dot(element: React.ReactElement) {
	const node = render(element).container.firstElementChild;
	return {
		tag: node?.tagName,
		cds: node?.getAttribute("data-cds"),
		className: node?.getAttribute("class")?.split(" "),
		style: node?.getAttribute("style"),
	};
}

/** Upstream's `_A`: every Pulse carries the fizzy-colour text remaps, before its motion and forced-colors classes. */
const STACKS = [
	"stacks:[--cds-text-primary:var(--cds-fizzy-lake-color-solid-primary)]",
	"stacks:[--cds-text-secondary:var(--cds-fizzy-lake-color-solid-secondary)]",
	"stacks:[--cds-text-muted:var(--cds-fizzy-lake-color-solid-muted)]",
];
const BASE = ["block", "size-[calc(0.375rem*var(--cds-rem-scale,1))]", "rounded-full", ...STACKS];

describe("Pulse (upstream ba)", () => {
	it("defaults to an animated accent dot with a 0.5px page-bg ring", () => {
		expect(dot(<Pulse />)).toStrictEqual({
			tag: "SPAN",
			cds: "Pulse",
			className: [...BASE, "motion-safe:animate-pulse", "forced-colors:!bg-[color:CanvasText]"],
			style: "background: var(--cds-fill-accent); box-shadow: 0 0 0 0.5px var(--cds-page-bg);",
		});
	});

	it("drops the animation and paints the given color", () => {
		expect(dot(<Pulse animate={false} color="var(--cds-fill-warning)" />)).toStrictEqual({
			tag: "SPAN",
			cds: "Pulse",
			className: [...BASE, "forced-colors:!bg-[color:CanvasText]"],
			style: "background: var(--cds-fill-warning); box-shadow: 0 0 0 0.5px var(--cds-page-bg);",
		});
	});

	it("draws hollow as an inset 1px ring with a CanvasText border in forced colors", () => {
		expect(dot(<Pulse hollow animate={false} color="var(--cds-text-muted)" />)).toStrictEqual({
			tag: "SPAN",
			cds: "Pulse",
			className: [
				...BASE,
				"forced-colors:border",
				"forced-colors:border-solid",
				"forced-colors:border-[color:CanvasText]",
			],
			style: "box-shadow: inset 0 0 0 1px var(--cds-text-muted), 0 0 0 0.5px var(--cds-page-bg);",
		});
	});

	it("appends className and forwards data attributes", () => {
		const {container} = render(
			<Pulse animate={false} className="absolute -top-px -end-px" data-palette-mark-dot="" />,
		);
		const node = container.firstElementChild;
		expect({
			className: node?.getAttribute("class")?.split(" "),
			mark: node?.getAttribute("data-palette-mark-dot"),
		}).toStrictEqual({
			className: [...BASE, "forced-colors:!bg-[color:CanvasText]", "absolute", "-top-px", "-end-px"],
			mark: "",
		});
	});
});

const ICON_CLASS =
	"col-start-1 row-start-1 [--btn-dot-r:calc(0.1875rem*var(--cds-rem-scale,1))] [--btn-dot-x:calc(100%_-_var(--btn-dot-r)_+_1px)] [&:dir(rtl)]:[--btn-dot-x:calc(var(--btn-dot-r)_-_1px)] not-forced-colors:has-[~[data-cds-part=indicator]>[data-cds=Pulse]]:[mask-image:radial-gradient(circle_at_var(--btn-dot-x)_calc(var(--btn-dot-r)_-_1px),transparent_calc(var(--btn-dot-r)_+_2px),black_calc(var(--btn-dot-r)_+_2.5px))]";
const INDICATOR_CLASS =
	"relative col-start-1 row-start-1 -me-px -mt-px self-start justify-self-end has-[>[data-cds=Pulse]]:[--cds-page-bg:transparent]";

describe("IndicatorSlot (upstream yb)", () => {
	it("stacks the masked icon and an aria-hidden indicator part in one grid cell", () => {
		const {container} = render(<IndicatorSlot icon={<svg data-icon="" />} indicator={<Pulse animate={false} />} />);
		const grid = container.firstElementChild;
		const [icon, indicator] = [...(grid?.children ?? [])];
		expect({
			grid: grid?.getAttribute("class"),
			children: grid?.children.length,
			icon: icon?.getAttribute("class"),
			iconChild: icon?.firstElementChild?.hasAttribute("data-icon"),
			indicator: {
				class: indicator?.getAttribute("class"),
				hidden: indicator?.getAttribute("aria-hidden"),
				part: indicator?.getAttribute("data-cds-part"),
				child: indicator?.firstElementChild?.getAttribute("data-cds"),
			},
		}).toStrictEqual({
			grid: "grid",
			children: 2,
			icon: ICON_CLASS,
			iconChild: true,
			indicator: {class: INDICATOR_CLASS, hidden: "true", part: "indicator", child: "Pulse"},
		});
	});

	it("returns the bare icon when there is no indicator", () => {
		expect(render(<IndicatorSlot icon={<svg data-icon="" />} indicator={undefined} />).container.innerHTML).toBe(
			'<svg data-icon=""></svg>',
		);
	});

	it("adds the labelled button's start/end margin to the grid", () => {
		const {container} = render(
			<IndicatorSlot icon={<svg />} indicator={<Pulse animate={false} />} className="-ms-1" />,
		);
		expect(container.firstElementChild?.getAttribute("class")).toBe("grid -ms-1");
	});
});
