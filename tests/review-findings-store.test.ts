// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {parseReportFindings} from "../src/lib/report-findings";
import {clearReviewFindingCursor, currentReviewFinding} from "../src/lib/review-finding-cursor";
import
{
	REVIEW_FINDINGS_STORAGE_KEY,
	clearReviewFindings,
	consumeAutoOpen,
	dismissReviewFinding,
	markReviewFindingsFixing,
	reloadReviewFindingsStore,
	reopenReviewFindings,
	resolveReviewFindingPaths,
	reviewFindingsSnapshot,
	setReviewFindings,
	toStoreFindings,
	unanchoredFindingIds,
} from "../src/lib/review-findings-store";
import {installLocalStorage} from "./fake-storage";

const SESSION = "store-session";

function parsed(files: readonly string[])
{
	const result = parseReportFindings(
		{
			level: "high",
			findings: files.map((file, index) => (
			{
				file,
				line: index + 10,
				summary: `Fake summary ${index}`,
				failure_scenario: `Fake scenario ${index}`,
			})),
		},
	);
	if (result === undefined) throw new Error("unparsed");
	return result;
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() =>
{
	storage = installLocalStorage();
	reloadReviewFindingsStore();
});

afterEach(() =>
{
	clearReviewFindingCursor(SESSION);
});

describe("transcript review findings store (upstream cc8941b7b diff-annotations)", () =>
{
	it("adapts parsed findings to store findings", () =>
	{
		expect(toStoreFindings("t", parsed(["a.ts"]), 5)).toStrictEqual([
			{
				id: "finding-t-0",
				filePath: "a.ts",
				side: "additions",
				startLine: 10,
				endLine: 10,
				line: 10,
				body: "Fake summary 0",
				detail: "Fake scenario 0",
				source: "finding",
				category: undefined,
				verdict: undefined,
				createdAt: 5,
			},
		]);
	});

	it("seeds without dismissed findings, records the tool once and makes the first current", () =>
	{
		const findings = toStoreFindings("t", parsed(["a.ts", "b.ts", "c.ts"]), 1);
		dismissReviewFinding(SESSION, "finding-t-1");
		setReviewFindings(
			SESSION,
			findings,
			{
				level: "high",
				toolId: "t",
				latestSettledToolId: "t",
			},
		);
		setReviewFindings(
			SESSION,
			findings,
			{
				level: "high",
				toolId: "t",
				latestSettledToolId: "t",
			},
		);
		const state = reviewFindingsSnapshot();

		expect(
			{
				ids: state.findingsBySession[SESSION]?.map((finding) => finding.id),
				seeded: state.seededToolIdsBySession[SESSION],
				latest: state.latestSettledAtActivationBySession[SESSION],
				level: state.reviewLevelBySession[SESSION],
				current: currentReviewFinding(SESSION),
			},
		).toStrictEqual(
			{
				ids: ["finding-t-0", "finding-t-2"],
				seeded: ["t"],
				latest: "t",
				level: "high",
				current: "finding-t-0",
			},
		);
	});

	it("persists findings, statuses and level but not the in-memory activation state", () =>
	{
		setReviewFindings(
			SESSION,
			toStoreFindings("t", parsed(["a.ts"]), 1),
			{
				level: "high",
				toolId: "t",
				latestSettledToolId: "t",
			},
		);
		markReviewFindingsFixing(SESSION, ["finding-t-0"]);
		const saved: unknown = JSON.parse(storage.getItem(REVIEW_FINDINGS_STORAGE_KEY) ?? "null");

		expect(Object.keys(saved as object).toSorted()).toStrictEqual([
			"findingStatusBySession",
			"findingsBySession",
			"reviewLevelBySession",
		]);
		reloadReviewFindingsStore();
		const reloaded = reviewFindingsSnapshot();
		expect(
			{
				ids: reloaded.findingsBySession[SESSION]?.map((finding) => finding.id),
				status: reloaded.findingStatusBySession[SESSION],
				seeded: reloaded.seededToolIdsBySession[SESSION],
			},
		).toStrictEqual(
			{
				ids: ["finding-t-0"],
				status:
				{
					"finding-t-0": "fixing",
				},
				seeded: undefined,
			},
		);
	});

	it("round-trips fixing back to open, and clears findings while keeping statuses", () =>
	{
		setReviewFindings(SESSION, toStoreFindings("t", parsed(["a.ts", "b.ts"]), 1));
		markReviewFindingsFixing(SESSION, ["finding-t-0", "finding-t-1"]);
		reopenReviewFindings(SESSION, ["finding-t-0"]);
		const reopened = reviewFindingsSnapshot().findingStatusBySession[SESSION];
		clearReviewFindings(SESSION, true);
		const kept = reviewFindingsSnapshot();
		clearReviewFindings(SESSION, false);

		expect(
			{
				reopened,
				keptFindings: kept.findingsBySession[SESSION],
				keptStatuses: kept.findingStatusBySession[SESSION],
				cleared: reviewFindingsSnapshot().findingStatusBySession[SESSION],
				current: currentReviewFinding(SESSION),
			},
		).toStrictEqual(
			{
				reopened:
				{
					"finding-t-0": "open",
					"finding-t-1": "fixing",
				},
				keptFindings: undefined,
				keptStatuses:
				{
					"finding-t-0": "open",
					"finding-t-1": "fixing",
				},
				cleared: undefined,
				current: null,
			},
		);
	});

	it("records an auto-open as consumed", () =>
	{
		consumeAutoOpen(SESSION, "t2");
		expect(reviewFindingsSnapshot().latestSettledAtActivationBySession[SESSION]).toBe("t2");
	});

	it("starts empty from a corrupt stored value", () =>
	{
		storage.setItem(REVIEW_FINDINGS_STORAGE_KEY, "{not json");
		reloadReviewFindingsStore();
		expect(reviewFindingsSnapshot().findingsBySession).toStrictEqual({});
	});

	it("maps findings to diff paths by exact path or unique suffix, leaving the rest unanchored", () =>
	{
		setReviewFindings(
			SESSION,
			toStoreFindings("t", parsed(["a.ts", "z.ts"]), 1),
			{
				toolId: "t",
			},
		);
		const before = unanchoredFindingIds(SESSION);
		resolveReviewFindingPaths(SESSION, "all", ["src/a.ts"]);

		expect(
			{
				before,
				after: unanchoredFindingIds(SESSION),
				resolved: reviewFindingsSnapshot().resolvedScopesBySession[SESSION],
			},
		).toStrictEqual(
			{
				before: null,
				after: new Set(["finding-t-1"]),
				resolved:
				{
					all:
					{
						"finding-t-0": "src/a.ts",
					},
				},
			},
		);
	});
});
