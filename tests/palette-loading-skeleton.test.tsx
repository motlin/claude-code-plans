// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {PaletteLoadingSkeleton} from "../src/components/palette-loading-skeleton";
import {paletteLoadingVariant} from "../src/lib/palette-loading";

afterEach(() =>
{
	cleanup();
});

interface Shape
{
	cls: string;
	style: string | null;
	kids: Shape[];
}

/** The element tree as classes and inline styles, skipping each bar's sr-only "Loading" label. */
function shape(el: Element): Shape
{
	return {
		cls: el.getAttribute("class") ?? "",
		style: el.getAttribute("style"),
		kids: [...el.children]
			.filter((child) => child.tagName !== "SPAN" || !child.classList.contains("sr-only"))
			.map(shape),
	};
}

const BAR_CLASS =
	"relative max-w-full overflow-hidden bg-[var(--skeleton-base)] after:absolute after:inset-0 after:animate-[shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--skeleton-sheen),transparent)] motion-reduce:after:hidden h-[1em] rounded";

function bar(width: number, height: number): Shape
{
	return {
		cls: BAR_CLASS,
		style: `width: ${width}px; height: ${height}px;`,
		kids: [],
	};
}

function node(cls: string, kids: Shape[], style: string | null = null): Shape
{
	return {
		cls,
		style,
		kids,
	};
}

const ROOT_CLASS = "flex flex-col max-h-[calc(min(100vh,var(--cp-visible-h,100vh))-var(--cp-top)-2rem)]";
const ROW_WIDTHS = [224, 176, 256, 200, 160, 240, 192];

function group(title: number, rows: number, offset: number): Shape
{
	return node("", [
		node("box-border flex h-[37px] w-full shrink-0 items-center px-3.5 pt-3 pb-2", [bar(title, 10)]),
		...Array.from(
			{
				length: rows,
			},
			(_, row) =>
				node("flex shrink-0 items-center gap-2 px-3 py-2 box-content h-5", [
					bar(20, 20),
					bar(ROW_WIDTHS[(row + offset) % 7] ?? 0, 14),
				]),
		),
	]);
}

function view(variant: "compose" | "search")
{
	const {container} = render(<PaletteLoadingSkeleton variant={variant} />);
	const root = container.firstElementChild;
	if (root === null) throw new Error("no skeleton");
	return {
		marker: root.hasAttribute("data-palette-loading"),
		hidden: [...root.querySelectorAll("[aria-hidden=true]")].length,
		tree: shape(root),
		bars: [...root.querySelectorAll<HTMLElement>("[data-cds=Skeleton]")].map(
			(el) => `${el.style.width}x${el.style.height}`,
		),
	};
}

describe("palette loading skeleton (upstream v8)", () =>
{
	it("draws upstream's Compose variant: the 118px inset-field box and a 2-bar footer", () =>
	{
		expect(view("compose")).toStrictEqual(
			{
				marker: true,
				hidden: 2,
				tree: node(ROOT_CLASS, [
					node("flex-shrink-0 pb-1", [
						node("relative box-border flex h-[7.375rem] items-start ps-[1.5rem] pt-[1.1rem] pe-2.5", [
							node(
								"pointer-events-none absolute inset-1.5 rounded-composer bg-fill-field shadow-panel-sm-cds",
								[],
							),
							node("relative flex h-8 items-center", [bar(144, 14)]),
						]),
					]),
					node("box-content flex h-5 flex-shrink-0 items-center gap-5 bg-surface-3 pb-2.5 ps-5 pe-4", [
						bar(56, 10),
						bar(120, 10),
					]),
				]),
				bars: ["144pxx14px", "56pxx10px", "120pxx10px"],
			},
		);
	});

	it("draws upstream's Search variant: header, tabs strip, hairline, 440px 3-group body and a 3-bar footer", () =>
	{
		expect(view("search")).toStrictEqual(
			{
				marker: true,
				hidden: 3,
				tree: node(ROOT_CLASS, [
					node("flex-shrink-0", [
						node("box-content flex h-8 items-center gap-2 ps-[1.5rem] pt-[1.1rem] pb-[0.9rem] pe-2.5", [
							bar(176, 14),
						]),
						node(
							"flex items-start gap-5 !ps-[2.125rem] relative -mt-1.5 px-[1.5rem]",
							[20, 40, 56, 58].map((width) => node("flex h-7 items-center", [bar(width, 12)])),
							"height: 42.4px;",
						),
						node(
							"border-t-[length:var(--cds-toolbar-line,0px)] h-[calc(0.5px_-_min(var(--cds-toolbar-line,0px),0.5px))] w-full bg-border bg-clip-padding",
							[],
						),
					]),
					node(
						"min-h-0 overflow-hidden p-2.5",
						[node("flex flex-col gap-1", [group(88, 1, 0), group(56, 5, 1), group(56, 2, 6)])],
						"height: 440px;",
					),
					node(
						"box-content flex h-5 flex-shrink-0 items-center gap-5 bg-surface-3 py-2.5 ps-5 pe-4 border-t-[length:max(var(--cds-toolbar-line,0px),0.5px)] border-border pointer-coarse:hidden",
						[bar(64, 10), bar(72, 10), bar(88, 10)],
					),
				]),
				bars: [
					"176pxx14px",
					"20pxx12px",
					"40pxx12px",
					"56pxx12px",
					"58pxx12px",
					"88pxx10px",
					"20pxx20px",
					"224pxx14px",
					"56pxx10px",
					"20pxx20px",
					"176pxx14px",
					"20pxx20px",
					"256pxx14px",
					"20pxx20px",
					"200pxx14px",
					"20pxx20px",
					"160pxx14px",
					"20pxx20px",
					"240pxx14px",
					"56pxx10px",
					"20pxx20px",
					"192pxx14px",
					"20pxx20px",
					"224pxx14px",
					"64pxx10px",
					"72pxx10px",
					"88pxx10px",
				],
			},
		);
	});

	it("picks Compose only for a remembered Compose off a phone (upstream $x plus the coarse < 40rem rule)", () =>
	{
		const cases: Array<["search" | "compose", boolean]> = [
			["compose", false],
			["compose", true],
			["search", false],
			["search", true],
		];
		expect(cases.map(([mode, phone]) => paletteLoadingVariant(mode, phone))).toStrictEqual([
			"compose",
			"search",
			"search",
			"search",
		]);
	});
});
