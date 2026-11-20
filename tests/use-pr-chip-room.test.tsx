// @vitest-environment jsdom

import {useRef} from "react";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {usePrChipRoom} from "../src/components/changes/pr-chip-room";

/** Widths by `data-w` name: offsetWidth and clientWidth both read them. */
const widths = new Map<string, number>();
const observers: FakeObserver[] = [];

class FakeObserver
{
	readonly observed = new Set<Element>();
	disconnected = false;
	constructor(readonly callback: () => void)
	{
		observers.push(this);
	}
	observe(target: Element)
	{
		this.observed.add(target);
	}
	unobserve(target: Element)
	{
		this.observed.delete(target);
	}
	disconnect()
	{
		this.disconnected = true;
	}
}

function width(this: HTMLElement): number
{
	return widths.get(this.dataset["w"] ?? "") ?? 0;
}

function Harness()
{
	const chipRef = useRef<HTMLSpanElement>(null);
	const partsRef = useRef<HTMLSpanElement>(null);
	const state = usePrChipRoom(
		{
			chipRef,
			partsRef,
			afterBadge: false,
		},
	);
	return (
		<div data-w="row">
			<div data-w="lead">
				<span data-w="label" data-diff-scope-label="" />
				<span ref={chipRef} data-chip-room={state}>
					<span ref={partsRef} data-w="parts">
						<a data-w="link" href="https://github.com/o/r/pull/56">
							#56
						</a>
					</span>
				</span>
			</div>
		</div>
	);
}

beforeEach(() =>
{
	widths.clear();
	observers.length = 0;
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(width);
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(width);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("usePrChipRoom", () =>
{
	it("shrinks to short when a resize leaves under 2px free, and disconnects on unmount", () =>
	{
		widths.set("row", 300).set("lead", 240).set("label", 197).set("parts", 42).set("link", 56);
		const view = render(<Harness />);
		const chip = () => view.container.querySelector("[data-chip-room]")?.getAttribute("data-chip-room");
		const atRest = chip();
		const observed = [...(observers.at(-1)?.observed ?? [])].map((el) => (el as HTMLElement).dataset["w"] ?? "");

		widths.set("row", 241);
		act(() =>
		{
			observers.at(-1)?.callback();
		});
		const tight = chip();
		const last = observers.at(-1);
		view.unmount();

		expect(
			{
				atRest,
				observed: observed.toSorted((a, b) => a.localeCompare(b)),
				tight,
				disconnected: last?.disconnected,
			},
		).toEqual(
			{
				atRest: "number",
				observed: ["label", "lead", "parts", "row"],
				tight: "short",
				disconnected: true,
			},
		);
	});
});
