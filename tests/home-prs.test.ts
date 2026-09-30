import {describe, expect, it} from "vite-plus/test";

import {homePrState, prPill, selectHomePrs, type HomePrSource} from "../src/lib/home-prs";

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 8, 29, 12, 0).getTime();

describe("prPill", () => {
	it("mirrors upstream's pill map in precedence order", () => {
		const none = null;
		const green = {passed: 3, failed: 0, pending: 0};
		const failing = {passed: 2, failed: 1, pending: 1};
		const running = {passed: 2, failed: 0, pending: 3};
		expect([
			prPill("merged", green),
			prPill("closed", green),
			prPill("draft", failing),
			prPill("conflicting", failing),
			prPill("changesRequested", failing),
			prPill("open", failing),
			prPill("approved", failing),
			prPill("queued", green),
			prPill("approved", green),
			prPill("approved", none),
			prPill("approved", running),
			prPill("open", running),
			prPill("open", green),
			prPill("open", none),
		]).toStrictEqual([
			{label: "Merged", tone: "neutral", category: "other"},
			{label: "Closed", tone: "closed", category: "other"},
			{label: "Draft", tone: "neutral", category: "other"},
			{label: "Conflicting", tone: "orange", category: "needsAttention"},
			{label: "Changes requested", tone: "closed", category: "needsAttention"},
			{label: "CI failing", tone: "red", category: "needsAttention"},
			{label: "CI failing", tone: "red", category: "needsAttention"},
			{label: "Queued", tone: "yellow", category: "other"},
			{label: "Ready to merge", tone: "green", category: "readyToMerge"},
			{label: "Ready to merge", tone: "green", category: "readyToMerge"},
			{label: "Approved", tone: "green", category: "other"},
			{label: "CI 2/5", tone: "neutral", category: "other"},
			{label: "Ready for review", tone: "neutral", category: "other"},
			{label: "Ready for review", tone: "neutral", category: "other"},
		]);
	});
});

describe("homePrState", () => {
	it("folds the review decision into an open PR's state", () => {
		expect([
			homePrState({state: "open", review: "APPROVED"}),
			homePrState({state: "open", review: "CHANGES_REQUESTED"}),
			homePrState({state: "open", review: "REVIEW_REQUIRED"}),
			homePrState({state: "open"}),
			homePrState({state: "draft", review: "APPROVED"}),
			homePrState({state: "merged", review: "APPROVED"}),
		]).toStrictEqual(["approved", "changesRequested", "open", "open", "draft", "merged"]);
	});
});

function source(sessionId: string, overrides: Partial<HomePrSource> = {}): HomePrSource {
	return {
		sessionId,
		sessionTitle: `Session ${sessionId}`,
		lastActivityAt: NOW - MINUTE,
		pr: {
			number: 1,
			state: "open",
			url: "https://github.com/alice/widgets/pull/1",
			title: `PR ${sessionId}`,
		},
		...overrides,
	};
}

describe("selectHomePrs", () => {
	it("keeps active non-draft PRs with a url, deduped by url, attention and ready first", () => {
		const shared = "https://github.com/alice/widgets/pull/9";
		const rows = selectHomePrs([
			source("newest", {lastActivityAt: NOW - MINUTE}),
			source("dupe-new", {
				lastActivityAt: NOW - 2 * MINUTE,
				pr: {number: 9, state: "open", url: shared},
			}),
			source("draft", {pr: {number: 2, state: "draft", url: "https://x/pull/2"}}),
			source("merged", {pr: {number: 3, state: "merged", url: "https://x/pull/3"}}),
			source("closed", {pr: {number: 4, state: "closed", url: "https://x/pull/4"}}),
			source("no-url", {pr: {number: 5, state: "open"}}),
			source("no-pr", {pr: undefined}),
			source("dupe-old", {
				lastActivityAt: NOW - 3 * MINUTE,
				pr: {number: 9, state: "open", url: shared, title: "Older copy"},
			}),
			source("failing", {
				lastActivityAt: NOW - 10 * MINUTE,
				pr: {
					number: 6,
					state: "open",
					url: "https://github.com/bob/gadgets/pull/6",
					checks: {passed: 1, failed: 1, pending: 0},
				},
			}),
			source("ready", {
				lastActivityAt: NOW - 20 * MINUTE,
				pr: {
					number: 7,
					state: "open",
					url: "https://github.com/bob/gadgets/pull/7",
					title: "Ship it",
					review: "APPROVED",
					checks: {passed: 4, failed: 0, pending: 0},
				},
			}),
		]);

		expect(
			rows.map((row) => ({
				sessionId: row.sessionId,
				title: row.title,
				number: row.number,
				repo: row.repo,
				label: row.pill.label,
			})),
		).toStrictEqual([
			{
				sessionId: "failing",
				title: "Session failing",
				number: 6,
				repo: "bob/gadgets",
				label: "CI failing",
			},
			{
				sessionId: "ready",
				title: "Ship it",
				number: 7,
				repo: "bob/gadgets",
				label: "Ready to merge",
			},
			{
				sessionId: "newest",
				title: "PR newest",
				number: 1,
				repo: "alice/widgets",
				label: "Ready for review",
			},
			{
				sessionId: "dupe-new",
				title: "Session dupe-new",
				number: 9,
				repo: "alice/widgets",
				label: "Ready for review",
			},
		]);
	});
});
