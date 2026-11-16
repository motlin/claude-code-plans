// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	endFind,
	type FindProvider,
	hasFindProviders,
	recountFind,
	registerFindProvider,
	runFind,
} from "../src/lib/find-in-page/store";

interface FakeProvider extends FindProvider
{
	readonly calls: [string, number, boolean][];
}

function fakeProvider(scope: Element, matches: number): FakeProvider
{
	const calls: [string, number, boolean][] = [];
	return {
		surface: "list",
		calls,
		count: (query) => (query === "x" ? matches : 0),
		show: (query, index, reveal) =>
		{
			calls.push([query, index, reveal]);
		},
		clear: () => undefined,
		getScopeEl: () => scope,
	};
}

describe("find-in-page store", () =>
{
	const unregister: (() => void)[] = [];

	beforeEach(() =>
	{
		// jsdom lays nothing out and has no Range rects; this file's ranges all count as laid out.
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
		document.body.innerHTML = `
			<p>x before</p>
			<div id="first"><p>x inside the first scope is the provider's</p></div>
			<p>x between</p>
			<div id="second"></div>
			<p>x after</p>
			<div data-find-provider-scope=""><input aria-label="Find"><span>x bar</span></div>`;
	});

	afterEach(() =>
	{
		Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
		endFind();
		for (const off of unregister.splice(0)) off();
		vi.restoreAllMocks();
	});

	function providers(): [FakeProvider, FakeProvider]
	{
		const first = fakeProvider(document.getElementById("first") as Element, 2);
		const second = fakeProvider(document.getElementById("second") as Element, 1);
		// Registered out of document order: the global order follows the scopes' DOM positions.
		unregister.push(registerFindProvider(second), registerFindProvider(first));
		return [first, second];
	}

	it("tracks whether any provider is registered", () =>
	{
		const before = hasFindProviders();
		const off = registerFindProvider(fakeProvider(document.body, 0));
		const during = hasFindProviders();
		off();
		expect([before, during, hasFindProviders()]).toStrictEqual([false, true, false]);
	});

	it("orders DOM matches and provider matches top to bottom and steps through them with wrap", () =>
	{
		const [first, second] = providers();
		const results = [
			runFind("x", true, true),
			...Array.from(
				{
					length: 6,
				},
				() => runFind("x", true, false),
			),
			runFind("x", false, false),
		].map(({activeIndex, total}) => `${activeIndex}/${total}`);
		expect(
			{
				results,
				firstActive: first.calls.filter(([, index]) => index >= 0).map(([, index]) => index),
				secondActive: second.calls.filter(([, index]) => index >= 0).map(([, index]) => index),
			},
		).toStrictEqual(
			{
				// before (1), first scope (2, 3), between (4), second scope (5), after (6); the bar never counts.
				results: ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6", "1/6", "6/6"],
				firstActive: [0, 1],
				secondActive: [0],
			},
		);
	});

	it("starts at match 1 for each new query and reports 0/0 without matches", () =>
	{
		providers();
		expect(
			[runFind("x", true, true), runFind("zzqxq", true, true), runFind("between", true, true)].map(
				({activeIndex, total}) => `${activeIndex}/${total}`,
			),
		).toStrictEqual(["1/6", "0/0", "1/1"]);
	});

	it("waits on a provider paging in the rest of its content, then recounts with the active match kept", async () =>
	{
		let matches = 1;
		let land: () => void = () => undefined;
		const loaded = new Promise<void>((resolve) =>
		{
			land = resolve;
		});
		unregister.push(
			registerFindProvider(
				{
					...fakeProvider(document.getElementById("second") as Element, 0),
					count: () => matches,
					loadRest: async () => loaded,
				},
			),
		);
		const {settled, ...first} = runFind("between", true, true);
		matches = 3;
		land();
		const landed = await settled;
		const step = runFind("between", true, false);
		expect(
			{
				first,
				landed,
				step: [step.activeIndex, step.total, step.settled],
			},
		).toStrictEqual(
			{
				first:
				{
					activeIndex: 1,
					total: 2,
				},
				landed:
				{
					activeIndex: 1,
					total: 4,
				},
				step: [2, 4, undefined],
			},
		);
	});

	it("keeps the active DOM match across a recount when text is added above it", () =>
	{
		providers();
		runFind("x", true, true);
		runFind("x", true, false);
		runFind("x", true, false);
		const before = runFind("x", true, false);
		document.body.insertAdjacentHTML("afterbegin", "<p>x added</p>");
		const after = recountFind();
		expect([before, after].map((result) => `${result.activeIndex}/${result.total}`)).toStrictEqual(["4/6", "5/7"]);
	});
});
