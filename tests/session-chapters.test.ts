import {describe, expect, it} from "vite-plus/test";

import {
	appendClaudeChapters,
	buildSessionChapters,
	extractClaudeChapters,
	hasOutline,
	pickActiveChapter,
	type SessionChapter,
} from "../src/lib/session-chapters";

function chapterCall(
	uuid: string,
	id: string,
	input: Record<string, unknown>,
	name = "mcp__ccd_session__mark_chapter",
) {
	return {type: "assistant", uuid, message: {role: "assistant", content: [{type: "tool_use", id, name, input}]}};
}

function result(uuid: string, id: string, content: string, isError = false, fields: Record<string, unknown> = {}) {
	return {
		type: "user",
		uuid,
		...fields,
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: id, content, ...(isError ? {is_error: true} : {})}],
		},
	};
}

const read = {
	type: "assistant",
	uuid: "a-read",
	message: {
		role: "assistant",
		content: [{type: "tool_use", id: "toolu_read", name: "Read", input: {file_path: "/x"}}],
	},
};

describe("extractClaudeChapters", () => {
	it("lists every titled chapter call in file order with its record's uuid and index", () => {
		const records = [
			{type: "user", uuid: "u-0", message: {role: "user", content: "Fabricated request"}},
			chapterCall("a-1", "toolu_ch1", {title: " Plan the work ", summary: " Read the queue "}, "MarkChapter"),
			result("r-1", "toolu_ch1", 'Chapter marked: "Plan the work". Continue your current work.'),
			read,
			chapterCall("a-4", "toolu_ch2", {title: "Ship it"}),
			undefined,
		];
		expect(extractClaudeChapters(records)).toStrictEqual([
			{id: "toolu_ch1", title: "Plan the work", summary: "Read the queue", uuid: "a-1", recordIndex: 1},
			{id: "toolu_ch2", title: "Ship it", uuid: "a-4", recordIndex: 4},
		]);
	});

	it("skips an untitled call and a failed one but keeps an interrupted one", () => {
		const records = [
			chapterCall("a-0", "toolu_blank", {title: "  "}),
			chapterCall("a-1", "toolu_failed", {title: "Failed"}),
			result("r-1", "toolu_failed", "Denied by user", true),
			chapterCall("a-3", "toolu_stopped", {title: "Stopped"}),
			result("r-3", "toolu_stopped", "[Request interrupted by user for tool use]", true),
		];
		expect(extractClaudeChapters(records)).toStrictEqual([
			{id: "toolu_stopped", title: "Stopped", uuid: "a-3", recordIndex: 3},
		]);
	});

	it("keeps a chapter whose lone result upstream reads as interrupted by its denial kind or toolUseResult", () => {
		const records = [
			chapterCall("a-0", "toolu_cancelled", {title: "Cancelled"}),
			result("r-0", "toolu_cancelled", "Example stop notice.", true, {toolDenialKind: "cancelled"}),
			chapterCall("a-2", "toolu_rejected", {title: "Rejected"}),
			result("r-2", "toolu_rejected", "Example refusal.", true, {
				toolDenialKind: "user-rejected",
				toolUseResult: "User rejected tool use",
			}),
			chapterCall("a-4", "toolu_refused", {title: "Refused"}),
			result("r-4", "toolu_refused", "Example refusal.", true, {toolDenialKind: "user-rejected"}),
		];
		expect(extractClaudeChapters(records)).toStrictEqual([
			{id: "toolu_cancelled", title: "Cancelled", uuid: "a-0", recordIndex: 0},
			{id: "toolu_rejected", title: "Rejected", uuid: "a-2", recordIndex: 2},
		]);
	});

	it("appends a window's records at their session-absolute index, a later failure removing an earlier chapter", () => {
		const earlier = extractClaudeChapters([chapterCall("a-0", "toolu_ch1", {title: "One"})]);
		const appended = appendClaudeChapters(
			earlier,
			[result("r-7", "toolu_ch1", "boom", true), chapterCall("a-8", "toolu_ch2", {title: "Two"})],
			7,
		);
		expect({earlier, appended}).toStrictEqual({
			earlier: [{id: "toolu_ch1", title: "One", uuid: "a-0", recordIndex: 0}],
			appended: [{id: "toolu_ch2", title: "Two", uuid: "a-8", recordIndex: 8}],
		});
	});
});

describe("buildSessionChapters", () => {
	const claudeChapters = [
		{id: "toolu_plan", title: "Plan the work", summary: "Read the queue", uuid: "a-1", recordIndex: 3},
		{id: "toolu_build", title: "Build it", uuid: "a-2", recordIndex: 9},
		{id: "toolu_hidden", title: "Deleted chapter", uuid: "a-3", recordIndex: 12},
	];
	const store = {
		renames: {toolu_build: "Build the outline"},
		hidden: ["toolu_hidden"],
		userChapters: [
			{id: "uch-late", afterId: "u-late", title: "Late pin", recordIndex: 15},
			{id: "uch-tie", afterId: "a-2", title: "Pinned on the chapter's record", recordIndex: 9},
			{id: "uch-early", afterId: "u-early", title: "Early pin", recordIndex: 1},
		],
	};

	it("merges Claude's and the user's chapters in transcript order under Session start, a pin first on a tie", () => {
		expect(
			buildSessionChapters({claudeChapters, store, firstEntryUuid: "u-0", sessionStartTitle: "Session start"}),
		).toStrictEqual([
			{id: "session-start", title: "Session start", source: "session", uuid: "u-0", recordIndex: 0},
			{id: "uch-early", title: "Early pin", source: "user", uuid: "u-early", recordIndex: 1},
			{
				id: "toolu_plan",
				title: "Plan the work",
				summary: "Read the queue",
				source: "claude",
				uuid: "a-1",
				recordIndex: 3,
			},
			{id: "uch-tie", title: "Pinned on the chapter's record", source: "user", uuid: "a-2", recordIndex: 9},
			{id: "toolu_build", title: "Build the outline", source: "claude", uuid: "a-2", recordIndex: 9},
			{id: "uch-late", title: "Late pin", source: "user", uuid: "u-late", recordIndex: 15},
		]);
	});

	it("has no Session start without a first entry, and an outline only once a chapter is not the session's", () => {
		const none = {renames: {}, hidden: [], userChapters: []};
		const empty = buildSessionChapters({
			claudeChapters: [],
			store: none,
			firstEntryUuid: undefined,
			sessionStartTitle: "Session start",
		});
		const startOnly = buildSessionChapters({
			claudeChapters: [],
			store: none,
			firstEntryUuid: "u-0",
			sessionStartTitle: "Session start",
		});
		const onePin = buildSessionChapters({
			claudeChapters: [],
			store: {...none, userChapters: [{id: "uch-one", afterId: "u-0", title: "Kickoff", recordIndex: 0}]},
			firstEntryUuid: "u-0",
			sessionStartTitle: "Session start",
		});

		expect({
			empty,
			emptyOutline: hasOutline(empty),
			startOnly,
			startOnlyOutline: hasOutline(startOnly),
			onePin,
			onePinOutline: hasOutline(onePin),
		}).toStrictEqual({
			empty: [],
			emptyOutline: false,
			startOnly: [{id: "session-start", title: "Session start", source: "session", uuid: "u-0", recordIndex: 0}],
			startOnlyOutline: false,
			onePin: [
				{id: "session-start", title: "Session start", source: "session", uuid: "u-0", recordIndex: 0},
				{id: "uch-one", title: "Kickoff", source: "user", uuid: "u-0", recordIndex: 0},
			],
			onePinOutline: true,
		});
	});
});

describe("pickActiveChapter", () => {
	const chapters: SessionChapter[] = [
		{id: "session-start", title: "Session start", source: "session", uuid: "u-0", recordIndex: 0},
		{id: "toolu_plan", title: "Plan", source: "claude", uuid: "a-1", recordIndex: 10},
		{id: "uch-pin", title: "Pin", source: "user", uuid: "u-2", recordIndex: 20},
		{id: "toolu_build", title: "Build", source: "claude", uuid: "a-3", recordIndex: 30},
	];
	const pick = (
		tops: Record<string, number>,
		overrides: Partial<Parameters<typeof pickActiveChapter>[1]> = {},
		list = chapters,
	) =>
		pickActiveChapter(list, {
			canScroll: true,
			distanceToBottomPx: 500,
			viewportTopPx: 164,
			firstVisibleRecordIndex: -1,
			getAnchorTop: (chapter) => tops[chapter.id] ?? null,
			...overrides,
		});

	it("picks the last chapter whose heading has reached the reading line, by upstream's rules", () => {
		const allMounted = {toolu_plan: 100, "uch-pin": 164, toolu_build: 165};
		expect({
			betweenAnchors: pick(allMounted),
			beforeFirstAnchor: pick({toolu_plan: 400, "uch-pin": 600, toolu_build: 900}),
			stopsAtFirstAnchorBelow: pick({toolu_plan: 400, "uch-pin": 100, toolu_build: 120}),
			atBottom: pick(allMounted, {distanceToBottomPx: 8}),
			atBottomButCannotScroll: pick(allMounted, {distanceToBottomPx: 0, canScroll: false}),
			justOffBottom: pick(allMounted, {distanceToBottomPx: 9}),
			unmountedBeforeFirstVisible: pick({toolu_build: 900}, {firstVisibleRecordIndex: 25}),
			unmountedClaudeOnFirstVisible: pick({}, {firstVisibleRecordIndex: 10}),
			unmountedUserOnFirstVisible: pick({toolu_plan: 50}, {firstVisibleRecordIndex: 20}),
			unmountedWithNoVisibleRow: pick({}),
			noChapters: pick({}, {}, []),
			noChaptersAtBottom: pick({}, {distanceToBottomPx: 0}, []),
		}).toStrictEqual({
			betweenAnchors: "uch-pin",
			beforeFirstAnchor: "session-start",
			stopsAtFirstAnchorBelow: "session-start",
			atBottom: "toolu_build",
			atBottomButCannotScroll: "uch-pin",
			justOffBottom: "uch-pin",
			unmountedBeforeFirstVisible: "uch-pin",
			unmountedClaudeOnFirstVisible: "session-start",
			unmountedUserOnFirstVisible: "uch-pin",
			unmountedWithNoVisibleRow: "session-start",
			noChapters: null,
			noChaptersAtBottom: null,
		});
	});
});
