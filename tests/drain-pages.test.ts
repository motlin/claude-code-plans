import {describe, expect, it} from "vite-plus/test";

import {DRAIN_PAGE_CAP, drainPages, type DrainResult} from "../src/lib/drain-pages";

/** A fetchNextPage stub answering each call with the next result; `calls` counts them. */
function stub(answer: (call: number) => DrainResult)
{
	const options: unknown[] = [];
	return {
		options,
		fetchNextPage: async (option: {cancelRefetch: boolean}) =>
		{
			options.push(option);
			return Promise.resolve(answer(options.length));
		},
	};
}

const page = (hasNextPage: boolean, overrides: Partial<DrainResult> = {}): DrainResult => (
{
	hasNextPage,
	isError: false,
	isFetchNextPageError: false,
	...overrides,
});

describe("drainPages", () =>
{
	it("pages until the feed runs out, at most 40 pages, stopping on an error or a throw, as upstream `_K`", async () =>
	{
		const threeMore = stub((call) => page(call < 4));
		const endless = stub(() => page(true));
		const failing = stub((call) =>
			page(
				true,
				{
					isFetchNextPageError: call === 2,
				},
			),
		);
		const queryError = stub(() =>
			page(
				false,
				{
					isError: true,
				},
			),
		);
		const throwing =
		{
			fetchNextPage: async () => Promise.reject(new Error("offline")),
		};

		expect(
			{
				threeMore: await drainPages(threeMore.fetchNextPage),
				threeMoreCalls: threeMore.options,
				endless: await drainPages(endless.fetchNextPage),
				endlessCalls: endless.options.length,
				failing: await drainPages(failing.fetchNextPage),
				failingCalls: failing.options.length,
				queryError: await drainPages(queryError.fetchNextPage),
				throwing: await drainPages(throwing.fetchNextPage),
				cap: DRAIN_PAGE_CAP,
			},
		).toStrictEqual(
			{
				threeMore:
				{
					exhausted: true,
				},
				threeMoreCalls: Array.from(
					{
						length: 4,
					},
					() => (
					{
						cancelRefetch: false,
					}),
				),
				endless:
				{
					exhausted: false,
				},
				endlessCalls: 41,
				failing:
				{
					exhausted: false,
				},
				failingCalls: 2,
				queryError:
				{
					exhausted: false,
				},
				throwing:
				{
					exhausted: false,
				},
				cap: 40,
			},
		);
	});

	it("stops where a caller's own predicate says no later page can matter, still exhausted", async () =>
	{
		const more = stub(() => page(true));

		expect(
			{
				result: await drainPages(more.fetchNextPage, (_result) => more.options.length < 2),
				calls: more.options.length,
			},
		).toStrictEqual(
			{
				result:
				{
					exhausted: true,
				},
				calls: 2,
			},
		);
	});
});
