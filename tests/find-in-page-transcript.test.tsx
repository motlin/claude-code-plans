// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {useRef, useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useFindListProvider} from "../src/lib/find-in-page/list-provider";
import {endFind, type FindResult, recountFind, runFind as runStoreFind} from "../src/lib/find-in-page/store";

interface Item
{
	key: string;
	text: string;
}

const WINDOW = 8;

/** Search inside act, so the row a show mounts commits with it. */
function runFind(query: string, forward: boolean, isNewQuery: boolean): FindResult
{
	let result: FindResult | undefined;
	act(() =>
	{
		result = runStoreFind(query, forward, isNewQuery);
	});
	if (result === undefined) throw new Error("no result");
	return result;
}

/** A minimal virtualized list: only `WINDOW` rows around the window's start are mounted. */
function VirtualList({items}: {items: Item[]})
{
	const [start, setStart] = useState(Math.max(0, items.length - WINDOW));
	const scopeRef = useRef<HTMLDivElement>(null);
	useFindListProvider(
		{
			items,
			surface: "transcript",
			getItemKey: (item) => item.key,
			getSearchText: (item) => item.text,
			getScopeEl: () => scopeRef.current,
			scrollToIndex: (index) =>
			{
				setStart(Math.max(0, Math.min(index - 1, items.length - WINDOW)));
			},
			getMountedRows: () =>
				[...(scopeRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].map(
					(row) => [Number(row.dataset["row"]), row] as const,
				),
		},
	);
	return (
		<div ref={scopeRef}>
			{items.slice(start, start + WINDOW).map((item, offset) => (
				<p key={item.key} data-row={start + offset}>
					{item.text}
				</p>
			))}
		</div>
	);
}

function items(count: number, needleAt: readonly number[]): Item[]
{
	return Array.from(
		{
			length: count,
		},
		(_, index) => (
		{
			key: `entry-${index}`,
			text: needleAt.includes(index) ? `entry ${index} mentions the needle` : `entry ${index}`,
		}),
	);
}

/** Run the frame-pair repaints, the mutation recount and the promises between them. */
async function settle(): Promise<void>
{
	await act(async () =>
	{
		await vi.runAllTimersAsync();
	});
}

class FakeHighlight extends Set<Range>
{
	priority = 0;
}

function painted(registry: Map<string, FakeHighlight>, name: string): string[]
{
	return [...(registry.get(name) ?? [])].map((range) => range.startContainer.parentElement?.dataset["row"] ?? "?");
}

describe("useFindListProvider", () =>
{
	let registry: Map<string, FakeHighlight>;

	beforeEach(() =>
	{
		registry = new Map();
		vi.stubGlobal("Highlight", FakeHighlight);
		vi.stubGlobal(
			"CSS",
			{
				highlights: registry,
			},
		);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			setTimeout(() =>
			{
				callback(0);
			}, 0),
		);
		vi.useFakeTimers();
		// jsdom lays nothing out and has no Range rects; this file's ranges all count as laid out.
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
	});

	afterEach(() =>
	{
		Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
		endFind();
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("counts a match in an unmounted entry, mounts it on show and paints it active", async () =>
	{
		render(<VirtualList items={items(40, [2, 39])} />);
		let result = runFind("needle", true, true);
		const first = `${result.activeIndex}/${result.total}`;
		await settle();
		const mountedRows = [...document.querySelectorAll<HTMLElement>("[data-row]")].map((row) => row.dataset["row"]);
		const afterShow =
		{
			all: painted(registry, "find-in-page"),
			active: painted(registry, "find-in-page-active"),
		};
		result = runFind("needle", true, false);
		await settle();
		expect(
			{
				first,
				mountedRows,
				afterShow,
				second: `${result.activeIndex}/${result.total}`,
				secondActive: painted(registry, "find-in-page-active"),
			},
		).toStrictEqual(
			{
				first: "1/2",
				mountedRows: ["1", "2", "3", "4", "5", "6", "7", "8"],
				afterShow:
				{
					all: ["2"],
					active: ["2"],
				},
				second: "2/2",
				secondActive: ["39"],
			},
		);
	});

	it("keeps the active match when an entry with the query is appended", async () =>
	{
		const {rerender} = render(<VirtualList items={items(40, [2, 39])} />);
		runFind("needle", true, true);
		await settle();
		rerender(<VirtualList items={items(41, [2, 39, 40])} />);
		const result = recountFind();
		expect(`${result.activeIndex}/${result.total}`).toBe("1/3");
	});

	it("keeps the active match by its entry key when an entry is prepended", async () =>
	{
		const {rerender} = render(<VirtualList items={items(40, [2, 39])} />);
		runFind("needle", true, true);
		runFind("needle", true, false);
		await settle();
		const withPrepended = [
			{
				key: "older",
				text: "an older needle",
			},
			...items(40, [2, 39]),
		];
		rerender(<VirtualList items={withPrepended} />);
		const result = recountFind();
		expect(`${result.activeIndex}/${result.total}`).toBe("3/3");
	});
});
