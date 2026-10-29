// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {
	addPlanComment,
	clearPlanComments,
	formatPlanFeedback,
	getPlanComments,
	planCommentOverlaps,
	removePlanComment,
	restorePlanComments,
	updatePlanComment,
	usePlanCommentCount,
	usePlanComments,
	type PlanComment,
} from "../src/lib/plan-comments";

const SESSION = "session-a";

afterEach(() => {
	clearPlanComments(SESSION);
	clearPlanComments("session-b");
});

function comment(id: string, selectedText: string, startOffset: number, text: string): PlanComment {
	return {id, selectedText, startOffset, endOffset: startOffset + selectedText.length, comment: text};
}

describe("formatPlanFeedback", () => {
	const live: PlanComment[] = [
		comment("c", "Green", 300, "Add oolong"),
		comment("a", "brewing one cup of tea", 10, "Use two cups"),
		comment("b", "about 95°C.\nPour the water", 120, "Multi line selection"),
	];

	it("matches upstream's text for the live comments plus typed text", () => {
		expect(formatPlanFeedback(live, "  Also make it iced.\n")).toBe(
			[
				"On selected text:",
				"> brewing one cup of tea",
				"Use two cups",
				"",
				"On selected text:",
				"> about 95°C.",
				"> Pour the water",
				"Multi line selection",
				"",
				"On selected text:",
				"> Green",
				"Add oolong",
				"",
				"",
				"Also make it iced.",
			].join("\n"),
		);
	});

	it("has no trailing newlines with comments only", () => {
		expect(formatPlanFeedback([live[1]!], "   ")).toBe("On selected text:\n> brewing one cup of tea\nUse two cups");
	});

	it("splits the selected text on CR, CRLF, LF, U+2028 and U+2029", () => {
		expect(formatPlanFeedback([comment("x", "a\r\nb\rc\u2028d\u2029e", 0, "note")], "")).toBe(
			"On selected text:\n> a\n> b\n> c\n> d\n> e\nnote",
		);
	});

	it("returns the trimmed typed text with no comments", () => {
		expect(formatPlanFeedback([], "  Make it iced. \n")).toBe("Make it iced.");
	});
});

describe("plan comment store", () => {
	it("adds comments in insertion order with generated ids", () => {
		addPlanComment(SESSION, {selectedText: "tea", startOffset: 5, endOffset: 8, comment: "one"});
		addPlanComment(SESSION, {selectedText: "cup", startOffset: 1, endOffset: 4, comment: "two"});
		const comments = getPlanComments(SESSION);
		expect(comments.map(({id: _id, ...rest}) => rest)).toStrictEqual([
			{selectedText: "tea", startOffset: 5, endOffset: 8, comment: "one"},
			{selectedText: "cup", startOffset: 1, endOffset: 4, comment: "two"},
		]);
		expect(comments.map((c) => /^\d+-[a-z0-9]{1,7}$/.test(c.id))).toStrictEqual([true, true]);
		expect(new Set(comments.map((c) => c.id)).size).toBe(2);
		expect(getPlanComments("session-b")).toStrictEqual([]);
	});

	it("updates and removes a comment by id", () => {
		addPlanComment(SESSION, {selectedText: "tea", startOffset: 5, endOffset: 8, comment: "one"});
		addPlanComment(SESSION, {selectedText: "cup", startOffset: 1, endOffset: 4, comment: "two"});
		const [first, second] = getPlanComments(SESSION);
		updatePlanComment(SESSION, first!.id, "edited");
		removePlanComment(SESSION, second!.id);
		expect(getPlanComments(SESSION)).toStrictEqual([{...first!, comment: "edited"}]);
	});

	it("clear returns the removed comments and restore prepends them", () => {
		addPlanComment(SESSION, {selectedText: "tea", startOffset: 5, endOffset: 8, comment: "one"});
		addPlanComment(SESSION, {selectedText: "cup", startOffset: 1, endOffset: 4, comment: "two"});
		const snapshot = clearPlanComments(SESSION);
		expect(getPlanComments(SESSION)).toStrictEqual([]);
		addPlanComment(SESSION, {selectedText: "pot", startOffset: 20, endOffset: 23, comment: "three"});
		restorePlanComments(SESSION, snapshot);
		expect(getPlanComments(SESSION).map((c) => c.comment)).toStrictEqual(["one", "two", "three"]);
		expect(clearPlanComments("session-b")).toStrictEqual([]);
	});

	it("detects overlaps with half-open ranges", () => {
		addPlanComment(SESSION, {selectedText: "tea", startOffset: 5, endOffset: 8, comment: "one"});
		expect([
			planCommentOverlaps(SESSION, 0, 5),
			planCommentOverlaps(SESSION, 8, 12),
			planCommentOverlaps(SESSION, 4, 6),
			planCommentOverlaps(SESSION, 7, 9),
			planCommentOverlaps(SESSION, 6, 7),
			planCommentOverlaps("session-b", 5, 8),
		]).toStrictEqual([false, false, true, true, true, false]);
	});
});

describe("plan comment hooks", () => {
	it("re-render with the session's comments and count", () => {
		const list = renderHook(() => usePlanComments(SESSION));
		const count = renderHook(() => usePlanCommentCount(SESSION));
		const none = renderHook(() => usePlanCommentCount(undefined));
		expect([list.result.current, count.result.current, none.result.current]).toStrictEqual([[], 0, 0]);
		act(() => {
			addPlanComment(SESSION, {selectedText: "tea", startOffset: 5, endOffset: 8, comment: "one"});
			addPlanComment("session-b", {selectedText: "cup", startOffset: 1, endOffset: 4, comment: "two"});
		});
		expect(list.result.current.map((c) => c.comment)).toStrictEqual(["one"]);
		expect([count.result.current, none.result.current]).toStrictEqual([1, 0]);
		act(() => {
			clearPlanComments(SESSION);
		});
		expect([list.result.current, count.result.current]).toStrictEqual([[], 0]);
	});
});
