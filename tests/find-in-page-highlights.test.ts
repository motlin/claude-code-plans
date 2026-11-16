import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {addFindRanges, clearFindHighlights, paintFindHighlights} from "../src/lib/find-in-page/highlights";

class FakeHighlight extends Set<Range>
{
	priority = 0;
}

function stubHighlightApi(): Map<string, FakeHighlight>
{
	const registry = new Map<string, FakeHighlight>();
	vi.stubGlobal("Highlight", FakeHighlight);
	vi.stubGlobal(
		"CSS",
		{
			highlights: registry,
		},
	);
	return registry;
}

function fakeRange(label: string): Range
{
	return {
		label,
	} as unknown as Range;
}

function snapshot(registry: Map<string, FakeHighlight>)
{
	return Object.fromEntries(
		[...registry].map(([name, highlight]) => [
			name,
			{
				priority: highlight.priority,
				ranges: [...highlight].map(
					(range) =>
						(
							range as unknown as
							{
								label: string;
							}
						).label,
				),
			},
		]),
	);
}

describe("find-in-page highlights", () =>
{
	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	it("paints every match into find-in-page and the active one into find-in-page-active at priority 1", () =>
	{
		const registry = stubHighlightApi();
		const [a, b, c] = [fakeRange("a"), fakeRange("b"), fakeRange("c")];
		paintFindHighlights([a, b], b);
		addFindRanges([c], null);
		expect(snapshot(registry)).toStrictEqual(
			{
				"find-in-page":
				{
					priority: 0,
					ranges: ["a", "b", "c"],
				},
				"find-in-page-active":
				{
					priority: 1,
					ranges: ["b"],
				},
			},
		);
		paintFindHighlights([c], null);
		expect(snapshot(registry)).toStrictEqual(
			{
				"find-in-page":
				{
					priority: 0,
					ranges: ["c"],
				},
				"find-in-page-active":
				{
					priority: 1,
					ranges: [],
				},
			},
		);
	});

	it("clear() removes both highlights", () =>
	{
		const registry = stubHighlightApi();
		paintFindHighlights([fakeRange("a")], null);
		clearFindHighlights();
		expect(snapshot(registry)).toStrictEqual({});
	});

	it("does nothing without the Highlight API", () =>
	{
		expect(() =>
		{
			paintFindHighlights([fakeRange("a")], null);
			clearFindHighlights();
		}).not.toThrow();
	});
});
