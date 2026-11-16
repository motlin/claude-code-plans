import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import type {ReviewFinding} from "../src/lib/review-diff";
import
{
	clearReviewFindingCursor,
	currentReviewFinding,
	findingCursorIndex,
	hideReviewFindings,
	reviewFindingsHidden,
	setCurrentReviewFinding,
	showReviewFindings,
	stepWrap,
	subscribeReviewFindingCursor,
} from "../src/lib/review-finding-cursor";

const finding = (id: string): ReviewFinding => (
{
	id,
	file: `src/${id}.ts`,
	side: "new",
	line: 1,
	severity: "low",
	title: `Fake finding ${id}`,
	body: "Fake body.",
	resolved: false,
});

const a = finding("a");
const b = finding("b");
const c = finding("c");

afterEach(() =>
{
	clearReviewFindingCursor("cursor-session");
	showReviewFindings("cursor-session");
});

describe("review finding cursor (upstream cc8941b7b currentFindingBySession, c9bd7af9c zw)", () =>
{
	it("indexes the current finding, counting a missing current as the first", () =>
	{
		expect([
			findingCursorIndex([a, b, c], null),
			findingCursorIndex([a, b, c], "c"),
			findingCursorIndex([a, b, c], "gone"),
		]).toStrictEqual([0, 2, 0]);
	});

	it("steps to the next finding, wrapping to the first, and to nothing from a lone finding", () =>
	{
		expect([stepWrap([a, b], "a"), stepWrap([a, b], "b"), stepWrap([a], "a")]).toStrictEqual([b, a, null]);
	});

	it("notifies once when the same current id is set twice, and clears it", () =>
	{
		const listener = vi.fn<() => void>();
		const unsubscribe = subscribeReviewFindingCursor(listener);
		setCurrentReviewFinding("cursor-session", "b");
		setCurrentReviewFinding("cursor-session", "b");
		const current = currentReviewFinding("cursor-session");
		clearReviewFindingCursor("cursor-session");
		unsubscribe();

		expect(
			{
				current,
				cleared: currentReviewFinding("cursor-session"),
				calls: listener.mock.calls.length,
			},
		).toStrictEqual(
			{
				current: "b",
				cleared: null,
				calls: 2,
			},
		);
	});

	it("hides a review's findings until they are shown again, dropping the current finding", () =>
	{
		setCurrentReviewFinding("cursor-session", "a");
		hideReviewFindings("cursor-session", "review-1");
		const hidden =
		{
			same: reviewFindingsHidden("cursor-session", "review-1"),
			other: reviewFindingsHidden("cursor-session", "review-2"),
			current: currentReviewFinding("cursor-session"),
		};
		showReviewFindings("cursor-session");

		expect(
			{
				hidden,
				shown: reviewFindingsHidden("cursor-session", "review-1"),
			},
		).toStrictEqual(
			{
				hidden:
				{
					same: true,
					other: false,
					current: null,
				},
				shown: false,
			},
		);
	});
});
