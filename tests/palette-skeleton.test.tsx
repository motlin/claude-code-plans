// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {PaletteEmptyViewSkeleton} from "../src/components/palette-skeleton";

afterEach(() =>
{
	cleanup();
});

/**
 * jsdom has no AnimationEvent, so React listens for the prefixed `webkitAnimationStart` and fireEvent drops
 * `animationName`; build the event by hand.
 */
function animationStart(target: Element, animationName: string)
{
	const event = new Event(
		"webkitAnimationStart",
		{
			bubbles: true,
		},
	);
	Object.defineProperty(
		event,
		"animationName",
		{
			value: animationName,
		},
	);
	fireEvent(target, event);
}

/** A wrapper child as `title:<width>`, `row:<width>` or `gap`. */
function kind(child: Element): string
{
	const bars = [...child.querySelectorAll<HTMLElement>("[data-skeleton]")];
	if (bars.length === 0) return `gap:${child.className}`;
	const width = bars.at(-1)?.style.width ?? "";
	return `${bars.length === 1 ? "title" : "row"}:${width}:${child.className}`;
}

function snapshot(container: HTMLElement)
{
	const group = container.firstElementChild as HTMLElement;
	const wrapper = group.querySelector(":scope > div");
	return {
		attrs:
		{
			cds: group.getAttribute("data-cds"),
			motion: group.getAttribute("data-motion"),
			role: group.getAttribute("role"),
			hold: group.getAttribute("data-hold"),
			reason: group.getAttribute("data-hold-reason"),
			shown: group.getAttribute("data-shown"),
			ariaHidden: group.getAttribute("aria-hidden"),
			className: group.className,
		},
		label: group.querySelector(":scope > span.sr-only[data-skeleton-label]")?.textContent,
		wrapper: `${wrapper?.getAttribute("aria-hidden")}:${wrapper?.className}`,
		children: [...(wrapper?.children ?? [])].map(kind),
		bars: [...group.querySelectorAll<HTMLElement>("[data-skeleton]")].map(
			(bar) => `${bar.style.width}x${bar.style.height}@${bar.style.getPropertyValue("--skel-i")}`,
		),
	};
}

const TITLE = "box-border flex h-[37px] w-full shrink-0 items-center px-3.5 pt-3 pb-2";
const ROW = "flex shrink-0 items-center gap-2 px-3 py-2 box-border h-9 w-full";
const GAP = "gap:h-1 w-full shrink-0";
const GROUP_CLASS = "flex min-h-0 grow basis-0 flex-col flex-wrap content-start overflow-hidden";

const CHILDREN = [
	`title:88px:${TITLE}`,
	`row:224px:${ROW}`,
	GAP,
	`title:56px:${TITLE}`,
	...[176, 256, 200, 160, 240].map((width) => `row:${width}px:${ROW}`),
	GAP,
	`title:56px:${TITLE}`,
	...[192, 224].map((width) => `row:${width}px:${ROW}`),
];

// Upstream `zh`: XG 88 + 1 row, h-1, XG 56 + 5 rows (offset 1), h-1, XG 56 + 2 rows (offset 6); bars numbered 0..18.
const BARS = [
	"88pxx10px@0",
	"20pxx20px@1",
	"224pxx14px@2",
	"56pxx10px@3",
	...[176, 256, 200, 160, 240].flatMap((width, row) => [
		`20pxx20px@${4 + row * 2}`,
		`${width}pxx14px@${5 + row * 2}`,
	]),
	"56pxx10px@14",
	"20pxx20px@15",
	"192pxx14px@16",
	"20pxx20px@17",
	"224pxx14px@18",
];

describe("PaletteEmptyViewSkeleton", () =>
{
	it("renders upstream's announced, delayed three-group skeleton and labels it when the reveal starts", () =>
	{
		const {container} = render(<PaletteEmptyViewSkeleton />);
		const before = snapshot(container);
		const group = container.firstElementChild as HTMLElement;
		animationStart(group, "placeholder-reveal");
		const revealed =
		{
			shown: group.getAttribute("data-shown"),
			label: group.querySelector("[data-skeleton-label]")?.textContent,
		};

		expect(
			{
				before,
				revealed,
			},
		).toStrictEqual(
			{
				before:
				{
					attrs:
					{
						cds: "SkeletonGroup",
						motion: "wave",
						role: "status",
						hold: "delayed",
						reason: null,
						shown: null,
						ariaHidden: null,
						className: GROUP_CLASS,
					},
					label: "",
					wrapper: "true:contents",
					children: CHILDREN,
					bars: BARS,
				},
				revealed:
				{
					shown: "",
					label: "Loading",
				},
			},
		);
	});

	it("ignores a bar's own animation starting before the reveal", () =>
	{
		const {container} = render(<PaletteEmptyViewSkeleton />);
		const group = container.firstElementChild as HTMLElement;
		animationStart(group.querySelector("[data-skeleton]")!, "placeholder-reveal");
		animationStart(group, "skeleton-breathe");

		expect(
			{
				shown: group.getAttribute("data-shown"),
				label: group.querySelector("[data-skeleton-label]")?.textContent,
			},
		).toStrictEqual(
			{
				shown: null,
				label: "",
			},
		);
	});

	it("draws the hand-off variant at once with its Loading label", () =>
	{
		const {container} = render(<PaletteEmptyViewSkeleton handoff />);

		expect(snapshot(container)).toStrictEqual(
			{
				attrs:
				{
					cds: "SkeletonGroup",
					motion: "wave",
					role: "status",
					hold: "none",
					reason: "handoff",
					shown: "",
					ariaHidden: null,
					className: GROUP_CLASS,
				},
				label: "Loading",
				wrapper: "true:contents",
				children: CHILDREN,
				bars: BARS,
			},
		);
	});
});
