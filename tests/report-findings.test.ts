import {describe, expect, it} from "vite-plus/test";

import
{
	findingRowSummary,
	groupFindingsByFile,
	hasFindingOutcomes,
	parseReportFindings,
	reviewCardState,
	reviewProgressAnnouncement,
	reviewSummaryText,
} from "../src/lib/report-findings";
import {ReportFindingsInputSchema} from "../src/lib/tool-input-schemas";

const finding = (file: string, summary = "s") => (
{
	file,
	summary,
});

describe("parseReportFindings (upstream ca8b34310 up/lp/sp/cp)", () =>
{
	it("normalizes a finding's optional fields", () =>
	{
		expect(
			parseReportFindings(
				{
					findings: [
						{
							file: "a.ts",
							summary: "s",
							category: "null-deref",
							failure_scenario: " - ",
						},
					],
				},
			),
		).toStrictEqual(
			{
				level: undefined,
				findings: [
					{
						file: "a.ts",
						summary: "s",
						short_summary: undefined,
						line: undefined,
						failure_scenario: undefined,
						category: "Null deref",
						verdict: undefined,
						outcome: undefined,
					},
				],
			},
		);
	});

	it("keeps valid level, line, verdict and outcome, and cuts a long category to 40", () =>
	{
		expect(
			parseReportFindings(
				{
					level: "xhigh",
					findings: [
						{
							file: "a.ts",
							line: 12,
							summary: "s",
							short_summary: "short",
							failure_scenario: "  boom ",
							category: "x".repeat(41),
							verdict: "CONFIRMED",
							outcome: "fixed",
						},
					],
				},
			),
		).toStrictEqual(
			{
				level: "xhigh",
				findings: [
					{
						file: "a.ts",
						summary: "s",
						short_summary: "short",
						line: 12,
						failure_scenario: "boom",
						category: `X${"x".repeat(39)}`,
						verdict: "CONFIRMED",
						outcome: "fixed",
					},
				],
			},
		);
	});

	it("rejects input whose every finding is invalid, and drops an unknown level", () =>
	{
		expect(
			{
				invalid: parseReportFindings(
					{
						findings: [{}],
					},
				),
				notArray: parseReportFindings(
					{
						findings: "nope",
					},
				),
				empty: parseReportFindings(
					{
						findings: [],
					},
				),
				huge: parseReportFindings(
					{
						level: "huge",
						findings: [],
					},
				),
			},
		).toStrictEqual(
			{
				invalid: undefined,
				notArray: undefined,
				empty:
				{
					level: undefined,
					findings: [],
				},
				huge:
				{
					level: undefined,
					findings: [],
				},
			},
		);
	});

	it("flags fix reports by any finding's outcome (upstream pj)", () =>
	{
		expect(
			{
				fixed: hasFindingOutcomes(
					{
						findings: [
							{
								file: "a.ts",
								summary: "s",
								outcome: "fixed",
							},
						],
					},
				),
				plain: hasFindingOutcomes(
					{
						findings: [finding("a.ts")],
					},
				),
			},
		).toStrictEqual(
			{
				fixed: true,
				plain: false,
			},
		);
	});

	it("accepts a fix report and a finding without a line in the strict schema", () =>
	{
		expect(
			ReportFindingsInputSchema.safeParse(
				{
					findings: [
						{
							file: "a.ts",
							summary: "s",
							failure_scenario: "f",
							outcome: "skipped",
						},
					],
				},
			).success,
		).toBe(true);
	});
});

describe("Code review card helpers (upstream c3fef5c6f eC/XS/ZS/QS)", () =>
{
	it("summarizes a row as the short summary, or the summary trimmed and cut at 72", () =>
	{
		const long = `${"word ".repeat(13)}tails, more words follow here`;
		const cut = findingRowSummary(
			{
				summary: long,
			},
		);
		expect(
			{
				short: findingRowSummary(
					{
						summary: "Long.",
						short_summary: "Short",
					},
				),
				trimmed: findingRowSummary(
					{
						summary: "Fix it.",
					},
				),
				cut,
				length: cut.length <= 73,
			},
		).toStrictEqual(
			{
				short: "Short",
				trimmed: "Fix it",
				cut: `${"word ".repeat(13)}tails\u2026`,
				length: true,
			},
		);
	});

	it("groups findings by file in first-seen order with unique-suffix labels", () =>
	{
		expect(
			groupFindingsByFile([finding("src/a/index.ts"), finding("src/b/index.ts"), finding("src/a/index.ts")]),
		).toStrictEqual([
			{
				file: "src/a/index.ts",
				label: "a/index.ts",
				entries: [
					{
						finding: finding("src/a/index.ts"),
						index: 0,
					},
					{
						finding: finding("src/a/index.ts"),
						index: 2,
					},
				],
			},
			{
				file: "src/b/index.ts",
				label: "b/index.ts",
				entries: [
					{
						finding: finding("src/b/index.ts"),
						index: 1,
					},
				],
			},
		]);
	});

	it("words the summary by level and count", () =>
	{
		expect([
			reviewSummaryText(undefined, 0),
			reviewSummaryText(undefined, 2),
			reviewSummaryText("xhigh", 3),
			reviewSummaryText("low", 1),
			reviewSummaryText("high", 0),
		]).toStrictEqual([
			"No issues found",
			"2 findings",
			"Extra high effort, 3 findings",
			"Low effort, 1 finding",
			"High effort, no issues found",
		]);
	});

	it("derives the card state and its progress announcement", () =>
	{
		const ids = ["f0", "f1"];
		expect(
			{
				empty: reviewCardState([], {}),
				actionable: reviewCardState(
					ids,
					{
						f0: "fixing",
					},
				),
				applying: reviewCardState(
					ids,
					{
						f0: "fixing",
						f1: "dismissed",
					},
				),
				terminal: reviewCardState(
					ids,
					{
						f0: "addressed",
						f1: "addressed",
					},
				),
				announcements: [
					reviewProgressAnnouncement(1, "applying"),
					reviewProgressAnnouncement(2, "applying"),
					reviewProgressAnnouncement(0, "terminal"),
					reviewProgressAnnouncement(0, "actionable"),
				],
			},
		).toStrictEqual(
			{
				empty: "empty",
				actionable: "actionable",
				applying: "applying",
				terminal: "terminal",
				announcements: ["1 fix in progress", "2 fixes in progress", "Review complete", ""],
			},
		);
	});
});
