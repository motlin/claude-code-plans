import {describe, expect, it} from "vite-plus/test";

import {PR_ENTRY_ORDER, prEntries, prEntryStateLine, type PrEntry} from "../src/lib/pr-entries";

const LINK =
{
	number: 12,
	url: "https://github.com/o/r/pull/12",
	repository: "o/r",
};

describe("prEntries", () =>
{
	it("returns no entries without a PR status", () =>
	{
		expect(prEntries(undefined, LINK)).toStrictEqual([]);
	});

	it("maps an open PR with changes requested to changesRequested, with the link's repo and url", () =>
	{
		expect(
			prEntries(
				{
					number: 12,
					state: "open",
					url: LINK.url,
					title: "Fix the thing",
					review: "CHANGES_REQUESTED",
				},
				LINK,
			),
		).toStrictEqual([
			{
				state: "changesRequested",
				repo: "o/r",
				number: 12,
				url: LINK.url,
				title: "Fix the thing",
			},
		]);
	});

	it("copies the diff stat counts only when the status knows them", () =>
	{
		expect([
			prEntries(
				{
					number: 1,
					state: "merged",
					additions: 10,
					deletions: 2,
				},
				undefined,
			),
			prEntries(
				{
					number: 2,
					state: "merged",
					additions: 0,
					deletions: 0,
				},
				undefined,
			),
			prEntries(
				{
					number: 3,
					state: "merged",
				},
				undefined,
			),
		]).toStrictEqual([
			[
				{
					state: "merged",
					number: 1,
					additions: 10,
					deletions: 2,
				},
			],
			[
				{
					state: "merged",
					number: 2,
					additions: 0,
					deletions: 0,
				},
			],
			[
				{
					state: "merged",
					number: 3,
				},
			],
		]);
	});

	it("maps an open approved PR to approved, and leaves a non-open approved PR alone", () =>
	{
		expect([
			prEntries(
				{
					number: 3,
					state: "open",
					review: "APPROVED",
				},
				undefined,
			),
			prEntries(
				{
					number: 4,
					state: "merged",
					review: "APPROVED",
				},
				undefined,
			),
			prEntries(
				{
					number: 5,
					state: "draft",
					review: "CHANGES_REQUESTED",
				},
				undefined,
			),
		]).toStrictEqual([
			[
				{
					state: "approved",
					number: 3,
				},
			],
			[
				{
					state: "merged",
					number: 4,
				},
			],
			[
				{
					state: "draft",
					number: 5,
				},
			],
		]);
	});

	it("drops a url that is not http(s) and falls back to the pr-link url", () =>
	{
		expect([
			prEntries(
				{
					number: 7,
					state: "closed",
					url: "javascript:alert(1)",
				},
				undefined,
			),
			prEntries(
				{
					number: 12,
					state: "closed",
				},
				LINK,
			),
			prEntries(
				{
					number: 8,
					state: "closed",
					url: "HTTP://example.com/pull/8",
				},
				undefined,
			),
		]).toStrictEqual([
			[
				{
					state: "closed",
					number: 7,
				},
			],
			[
				{
					state: "closed",
					repo: "o/r",
					number: 12,
					url: LINK.url,
				},
			],
			[
				{
					state: "closed",
					number: 8,
					url: "HTTP://example.com/pull/8",
				},
			],
		]);
	});

	it("derives ciState from checks: failed, then pending, then passed", () =>
	{
		const ci = (passed: number, failed: number, pending: number) =>
			prEntries(
				{
					number: 1,
					state: "open",
					checks:
					{
						passed,
						failed,
						pending,
					},
				},
				undefined,
			)[0]?.ciState;
		expect([ci(3, 1, 2), ci(3, 0, 2), ci(3, 0, 0), ci(0, 0, 0)]).toStrictEqual([
			"failed",
			"pending",
			"passed",
			"passed",
		]);
	});

	it("orders states the way upstream's HV does", () =>
	{
		expect(PR_ENTRY_ORDER).toStrictEqual(
			{
				conflicting: 0,
				changesRequested: 1,
				open: 2,
				approved: 3,
				draft: 4,
				queued: 5,
				merged: 6,
				closed: 7,
			},
		);
	});
});

describe("prEntryStateLine", () =>
{
	const entry = (state: PrEntry["state"], ciState?: PrEntry["ciState"]): PrEntry => (
	{
		state,
		number: 1,
		...(ciState === undefined
			? {}
			:
				{
					ciState,
				}),
	});

	it("reports checks on an open PR, and the state word otherwise", () =>
	{
		expect(
			[
				entry("open", "pending"),
				entry("open", "failed"),
				entry("open", "passed"),
				entry("open"),
				entry("approved", "failed"),
				entry("changesRequested"),
				entry("conflicting"),
				entry("draft", "pending"),
				entry("queued"),
				entry("merged"),
				entry("closed"),
			].map(prEntryStateLine),
		).toStrictEqual([
			"Checks running",
			"Checks failed",
			"Ready",
			"Ready",
			"Approved",
			"Changes requested",
			"Conflict",
			"Draft",
			"Queued",
			"Merged",
			"Closed",
		]);
	});
});
