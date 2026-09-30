import {describe, expect, it} from "vite-plus/test";

import {
	HomeAttentionKindSchema,
	attentionStatusLine,
	selectHomeAttention,
	type HomeAttentionRow,
} from "../src/lib/home-attention";
import {schemaChoiceRegistry} from "../src/lib/schema-choices";

const MINUTE = 60 * 1000;
const NOW = new Date(2026, 8, 29, 12, 0).getTime();

function row(sessionId: string, overrides: Partial<HomeAttentionRow> = {}): HomeAttentionRow {
	return {
		sessionId,
		title: sessionId,
		bucket: "blocked",
		project: "alpha",
		archived: false,
		createdAt: NOW - 60 * MINUTE,
		lastActivityAt: NOW - MINUTE,
		pendingApproval: null,
		summary: null,
		statusDetail: null,
		lastAssistantText: null,
		...overrides,
	};
}

function select(rows: HomeAttentionRow[], options: {pinnedIds?: string[]; dismissed?: Record<string, number>} = {}) {
	return selectHomeAttention({
		rows,
		pinnedIds: new Set(options.pinnedIds ?? []),
		dismissed: options.dismissed ?? {},
		now: NOW,
	}).map((item) => ({
		sessionId: item.session.sessionId,
		kind: item.kind,
		statusLine: item.statusLine,
	}));
}

describe("selectHomeAttention", () => {
	it("keeps only blocked and review rows, blocked first, each by last activity desc", () => {
		const rows = [
			row("review-old", {bucket: "review", lastActivityAt: NOW - 30 * MINUTE}),
			row("working", {bucket: "working", lastActivityAt: NOW}),
			row("blocked-old", {bucket: "blocked", lastActivityAt: NOW - 20 * MINUTE}),
			row("done", {bucket: "done", lastActivityAt: NOW}),
			row("review-new", {bucket: "review", lastActivityAt: NOW - 2 * MINUTE}),
			row("blocked-new", {bucket: "blocked", lastActivityAt: NOW - 10 * MINUTE}),
		];

		expect(select(rows)).toEqual([
			{sessionId: "blocked-new", kind: "blocked", statusLine: null},
			{sessionId: "blocked-old", kind: "blocked", statusLine: null},
			{sessionId: "review-new", kind: "review", statusLine: null},
			{sessionId: "review-old", kind: "review", statusLine: null},
		]);
	});

	it("excludes pinned and archived rows", () => {
		const rows = [
			row("pinned", {bucket: "blocked"}),
			row("archived", {bucket: "review", archived: true}),
			row("kept", {bucket: "review"}),
		];

		expect(select(rows, {pinnedIds: ["pinned"]})).toEqual([{sessionId: "kept", kind: "review", statusLine: null}]);
	});

	it("hides a dismissed row until newer activity arrives", () => {
		const activity = NOW - 5 * MINUTE;
		const rows = [
			row("dismissed-after", {lastActivityAt: activity}),
			row("dismissed-same", {lastActivityAt: activity}),
			row("resurfaced", {lastActivityAt: activity}),
		];

		expect(
			select(rows, {
				dismissed: {
					"dismissed-after": activity + MINUTE,
					"dismissed-same": activity,
					resurfaced: activity - MINUTE,
				},
			}),
		).toEqual([{sessionId: "resurfaced", kind: "blocked", statusLine: null}]);
	});

	it("returns the original session object", () => {
		const session = row("s1", {bucket: "review"});
		const [item] = selectHomeAttention({
			rows: [session],
			pinnedIds: new Set(),
			dismissed: {},
			now: NOW,
		});
		expect(item).toEqual({session, kind: "review", statusLine: null});
		expect(item?.session).toBe(session);
	});
});

describe("attentionStatusLine", () => {
	it.each([
		{
			name: "pending approval wins over everything",
			overrides: {
				pendingApproval: {toolName: "ExitPlanMode"},
				statusDetail: "Running tests",
				lastAssistantText: "Done.",
			},
			expected: "Waiting on permission: ExitPlanMode",
		},
		{
			name: "AskUserQuestion uses the upstream permission copy",
			overrides: {pendingApproval: {toolName: "AskUserQuestion"}},
			expected: "Waiting on permission: AskUserQuestion",
		},
		{
			name: "status detail when no approval is pending",
			overrides: {statusDetail: "  Running tests  ", lastAssistantText: "Done."},
			expected: "Running tests",
		},
		{
			name: "blank status detail falls through to the assistant line",
			overrides: {statusDetail: "   ", lastAssistantText: "\n\n  All tests pass.  \nMore detail"},
			expected: "All tests pass.",
		},
		{
			name: "blank assistant text gives no status line",
			overrides: {lastAssistantText: " \n\t "},
			expected: null,
		},
		{
			name: "nothing known gives no status line",
			overrides: {},
			expected: null,
		},
	])("$name", ({overrides, expected}) => {
		expect(attentionStatusLine(row("s", overrides))).toBe(expected);
	});

	it("flows into selectHomeAttention rows", () => {
		expect(select([row("s", {pendingApproval: {toolName: "AskUserQuestion"}})])).toEqual([
			{sessionId: "s", kind: "blocked", statusLine: "Waiting on permission: AskUserQuestion"},
		]);
	});
});

describe("HomeAttentionKindSchema", () => {
	it("is registered with the upstream pill labels", () => {
		expect(HomeAttentionKindSchema.options).toEqual(["blocked", "review"]);
		expect(schemaChoiceRegistry["HomeAttentionKindSchema"]).toEqual({
			blocked: "Needs input",
			review: "Ready for review",
		});
	});
});
