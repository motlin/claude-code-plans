import {afterEach, describe, expect, it} from "vite-plus/test";
import
{
	findingAfterDismiss,
	openReviewInChanges,
	scrollToFinding,
	scrollToFirstOpenFinding,
} from "../src/lib/changes-review";
import {clearDiffScrollTarget, diffScrollTarget} from "../src/lib/diff-scroll-target";
import type {ReviewFinding} from "../src/lib/review-diff";

const finding = (id: string, extra: Partial<ReviewFinding> = {}): ReviewFinding => (
{
	id,
	file: `src/${id}.ts`,
	side: "new",
	line: 10,
	severity: "medium",
	title: `Fake finding ${id}`,
	body: "Fake body.",
	resolved: false,
	...extra,
});

afterEach(() =>
{
	clearDiffScrollTarget("review-session");
});

describe("finding scroll targets (upstream cc8941b7b dismissReviewFinding, c3fef5c6f open findings)", () =>
{
	it("targets a finding's end line on its side, fuzzily", () =>
	{
		scrollToFinding(
			"review-session",
			finding(
				"a",
				{
					side: "old",
					line: 4,
					endLine: 6,
				},
			),
		);
		const old = diffScrollTarget("review-session");
		scrollToFinding(
			"review-session",
			finding(
				"b",
				{
					line: 12,
				},
			),
		);
		expect(
			{
				old,
				current: diffScrollTarget("review-session"),
			},
		).toStrictEqual(
			{
				old:
				{
					filePath: "src/a.ts",
					nonce: 1,
					fuzzy: true,
					anchor:
					{
						side: "deletions",
						line: 6,
					},
				},
				current:
				{
					filePath: "src/b.ts",
					nonce: 2,
					fuzzy: true,
					anchor:
					{
						side: "additions",
						line: 12,
					},
				},
			},
		);
	});

	it("moves to the next open finding after a dismissed one, else the previous, else none", () =>
	{
		const findings = [
			finding("a"),
			finding(
				"x",
				{
					resolved: true,
				},
			),
			finding("b"),
			finding("c"),
		];
		expect([
			findingAfterDismiss(findings, "a")?.id,
			findingAfterDismiss(findings, "b")?.id,
			findingAfterDismiss(findings, "c")?.id,
			findingAfterDismiss([finding("a")], "a"),
			findingAfterDismiss(findings, "missing"),
		]).toStrictEqual(["b", "c", "b", undefined, undefined]);
	});

	it("scrolls to the first open finding once per review request", () =>
	{
		const findings = [
			finding(
				"x",
				{
					resolved: true,
				},
			),
			finding(
				"a",
				{
					line: 3,
				},
			),
		];
		const unrequested = scrollToFirstOpenFinding("review-session", findings);
		openReviewInChanges("review-session", "review-1");
		const requested = scrollToFirstOpenFinding("review-session", findings);
		const target = diffScrollTarget("review-session");
		const again = scrollToFirstOpenFinding("review-session", findings);
		expect(
			{
				unrequested,
				requested,
				again,
				target,
			},
		).toStrictEqual(
			{
				unrequested: false,
				requested: true,
				again: false,
				target:
				{
					filePath: "src/a.ts",
					nonce: 1,
					fuzzy: true,
					anchor:
					{
						side: "additions",
						line: 3,
					},
				},
			},
		);
	});
});
