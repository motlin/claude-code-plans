// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {TurnStatusMarkSlot} from "../src/components/turn-status-mark-slot";
import {stubReducedMotion} from "./helpers/frame-queue";

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

function recordAnimate(): unknown[][]
{
	const calls: unknown[][] = [];
	Object.defineProperty(
		HTMLElement.prototype,
		"animate",
		{
			configurable: true,
			value(this: HTMLElement, ...args: unknown[])
			{
				calls.push(args);
				return {
					finished: Promise.resolve(),
					cancel()
					{
					},
				};
			},
		},
	);
	return calls;
}

function slot(motion: "busy" | "leaving", onLeft: () => void)
{
	return (
		<div
			style={
			{
				columnGap: "6px",
			}}
		>
			<TurnStatusMarkSlot motion={motion} onLeft={onLeft}>
				<span data-testid="mark" />
			</TurnStatusMarkSlot>
		</div>
	);
}

describe("TurnStatusMarkSlot", () =>
{
	it("holds the mark centred in upstream zG's 20px slot", () =>
	{
		const {container} = render(slot("busy", () => {}));
		expect(container.firstElementChild?.innerHTML).toBe(
			'<span aria-hidden="true" data-cds-row-mark="" class="relative flex h-[1lh] shrink-0 items-center justify-center w-[20px] me-[calc(12px_-_var(--cds-gap-xs))]"><span class="absolute top-1/2 left-1/2 flex size-icon -translate-x-1/2 -translate-y-1/2 items-center justify-center motion-reduce:transition-none opacity-100"><span data-testid="mark"></span></span></span>',
		);
	});

	it("collapses through the row gap over 400ms as upstream's leave, then calls onLeft", async () =>
	{
		stubReducedMotion(false);
		const calls = recordAnimate();
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 20, 16));
		const onLeft = vi.fn<() => void>();
		const {rerender, container} = render(slot("busy", onLeft));
		const mark = container.querySelector<HTMLElement>("[data-cds-row-mark]")!;
		mark.style.marginInlineEnd = "6px";
		rerender(slot("leaving", onLeft));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(
			{
				calls,
				left: onLeft.mock.calls.length,
			},
		).toStrictEqual(
			{
				calls: [
					[
						[
							{
								offset: 0,
								width: "20px",
								marginInlineEnd: "6px",
								opacity: 1,
								transform: "scale(1)",
							},
							{
								offset: 0.6,
								opacity: 1,
							},
							{
								offset: 1,
								width: "0px",
								marginInlineEnd: "calc(-1 * 6px)",
								opacity: 0,
								transform: "scale(0)",
							},
						],
						{
							duration: 400,
							easing: "cubic-bezier(0.22, 1, 0.36, 1)",
							fill: "forwards",
						},
					],
				],
				left: 1,
			},
		);
	});

	it("leaves at once under reduced motion", () =>
	{
		stubReducedMotion(true);
		const calls = recordAnimate();
		const onLeft = vi.fn<() => void>();
		const {rerender} = render(slot("busy", onLeft));
		rerender(slot("leaving", onLeft));
		expect(
			{
				calls,
				left: onLeft.mock.calls.length,
			},
		).toStrictEqual(
			{
				calls: [],
				left: 1,
			},
		);
	});
});
