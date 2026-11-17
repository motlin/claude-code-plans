// @vitest-environment jsdom

import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useEnvironmentBarIconOnly} from "../src/components/use-environment-bar-icon-only";

/** One bar's stubbed layout; `pickersRight` and `chipsLeft` may depend on whether the chips are collapsed. */
interface Geometry
{
	rowLeft: number;
	rowWidth: number;
	padding: number;
	wrapped: boolean;
	chipsLeft: (collapsed: boolean) => number;
	chipsRight: (collapsed: boolean) => number;
	pickersRight: (collapsed: boolean) => number;
	modeWidth: number;
}

let geometry: Geometry;
const observers: StubResizeObserver[] = [];
const mutationDisconnects = vi.fn<() => void>();

class StubResizeObserver
{
	readonly targets: Element[] = [];
	disconnected = false;
	constructor(readonly callback: ResizeObserverCallback)
	{
		observers.push(this);
	}
	observe(target: Element)
	{
		this.targets.push(target);
	}
	unobserve()
	{
	}
	disconnect()
	{
		this.disconnected = true;
	}
}

function rect(left: number, right: number): DOMRect
{
	return {
		left,
		right,
		width: right - left,
		top: 0,
		bottom: 24,
		height: 24,
		x: left,
		y: 0,
		toJSON: () => ({}),
	};
}

function collapsed(): boolean
{
	return screen.getByTestId("row").hasAttribute("data-icon-only");
}

function Harness({chipText = "claude-code-plans"}: {chipText?: string})
{
	const {iconOnly, rowRef, chipsRef, pickersRef, modeRef} = useEnvironmentBarIconOnly();
	return (
		<div
			data-testid="row"
			ref={rowRef}
			data-icon-only={iconOnly ? "" : undefined}
			style={
			{
				paddingLeft: `${geometry.padding}px`,
				paddingRight: `${geometry.padding}px`,
			}}
		>
			<div data-testid="chips" ref={chipsRef}>
				{chipText}
			</div>
			<div data-testid="pickers" ref={pickersRef}>
				Opus
				<div data-testid="mode" ref={modeRef}>
					Auto
				</div>
			</div>
		</div>
	);
}

/** Fire the bar's ResizeObserver, as a resize of the row would. */
function resize()
{
	const observer = observers.at(-1)!;
	act(() =>
	{
		observer.callback([], observer);
	});
}

beforeEach(() =>
{
	observers.length = 0;
	mutationDisconnects.mockClear();
	geometry =
	{
		rowLeft: 0,
		rowWidth: 400,
		padding: 10,
		wrapped: false,
		chipsLeft: () => 10,
		chipsRight: (isCollapsed) => (isCollapsed ? 40 : 200),
		pickersRight: () => 390,
		modeWidth: 80,
	};
	vi.stubGlobal("ResizeObserver", StubResizeObserver);
	const RealMutationObserver = globalThis.MutationObserver;
	vi.stubGlobal(
		"MutationObserver",
		class extends RealMutationObserver
		{
			override disconnect()
			{
				mutationDisconnects();
				super.disconnect();
			}
		},
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
	{
		const isCollapsed = document.querySelector("[data-testid=row]")?.hasAttribute("data-icon-only") ?? false;
		switch (this.dataset["testid"])
		{
			case "row":
				return rect(geometry.rowLeft, geometry.rowLeft + geometry.rowWidth);
			case "chips":
				return rect(geometry.chipsLeft(isCollapsed), geometry.chipsRight(isCollapsed));
			case "pickers":
				return rect(geometry.pickersRight(isCollapsed) - 150, geometry.pickersRight(isCollapsed));
			case "mode":
				return rect(0, geometry.modeWidth);
			default:
				return rect(0, 0);
		}
	});
	vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement)
	{
		return this.dataset["testid"] === "pickers" && geometry.wrapped ? 30 : 0;
	});
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("useEnvironmentBarIconOnly", () =>
{
	it("stays expanded while the pickers end within the row's content edge (0.5px tolerance)", () =>
	{
		geometry.pickersRight = () => 390.5;
		render(<Harness />);
		resize();

		expect(collapsed()).toBe(false);
	});

	it("collapses once the pickers overflow the row's content edge", () =>
	{
		geometry.pickersRight = (isCollapsed) => (isCollapsed ? 390 : 400);
		render(<Harness />);
		resize();

		expect(collapsed()).toBe(true);
	});

	it("stays collapsed when the row widens by less than the width it needed plus 2px", () =>
	{
		geometry.pickersRight = (isCollapsed) => (isCollapsed ? 390 : 400);
		render(<Harness />);
		resize();
		// It needed 400 + 10 = 410px; 411px is still inside the hysteresis.
		geometry.rowWidth = 411;
		geometry.pickersRight = () => 401;
		resize();

		expect(collapsed()).toBe(true);
	});

	it("expands once the row grows past the width it needed plus 2px and everything fits", () =>
	{
		geometry.pickersRight = (isCollapsed) => (isCollapsed ? 390 : 400);
		render(<Harness />);
		resize();
		geometry.rowWidth = 412;
		geometry.pickersRight = () => 402;
		resize();

		expect(collapsed()).toBe(false);
	});

	it("re-collapses within the same callback when the expanded layout still overflows", () =>
	{
		geometry.pickersRight = (isCollapsed) => (isCollapsed ? 390 : 400);
		render(<Harness />);
		resize();
		// Past the hysteresis, so pass one expands; the expanded pickers overflow again, so pass two re-collapses.
		geometry.rowWidth = 420;
		geometry.pickersRight = (isCollapsed) => (isCollapsed ? 390 : 430);
		resize();

		expect(collapsed()).toBe(true);
	});

	it("tries expanding when the chips' text changes while collapsed", async () =>
	{
		geometry.pickersRight = (isCollapsed) => (isCollapsed ? 390 : 400);
		const {rerender} = render(<Harness />);
		resize();
		expect(collapsed()).toBe(true);
		geometry.pickersRight = () => 390;
		rerender(<Harness chipText="x" />);

		await waitFor(() =>
		{
			expect(collapsed()).toBe(false);
		});
	});

	it("measures the chips line, not the pickers, once the row has wrapped", () =>
	{
		geometry.wrapped = true;
		geometry.pickersRight = () => 500;
		geometry.chipsRight = (isCollapsed) => (isCollapsed ? 40 : 395);
		render(<Harness />);
		resize();

		expect(collapsed()).toBe(true);
	});

	it("collapses on a start-edge overflow (RTL)", () =>
	{
		geometry.chipsLeft = (isCollapsed) => (isCollapsed ? 10 : 2);
		geometry.pickersRight = () => 390;
		geometry.wrapped = true;
		geometry.chipsRight = () => 200;
		render(<Harness />);
		resize();

		expect(collapsed()).toBe(true);
	});

	it("does nothing while the row has no width (a hidden bar)", () =>
	{
		geometry.rowWidth = 0;
		geometry.pickersRight = () => 500;
		render(<Harness />);
		resize();

		expect(collapsed()).toBe(false);
	});

	it("observes the row and the mode slot, and disconnects both observers on unmount", () =>
	{
		const {unmount} = render(<Harness />);
		const observer = observers.at(-1)!;
		expect(observer.targets.map((el) => (el as HTMLElement).dataset["testid"])).toStrictEqual(["row", "mode"]);
		unmount();

		expect(
			{
				resize: observer.disconnected,
				mutation: mutationDisconnects.mock.calls.length,
			},
		).toStrictEqual(
			{
				resize: true,
				mutation: 1,
			},
		);
	});
});
