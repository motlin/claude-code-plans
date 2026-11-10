import {describe, expect, it} from "vite-plus/test";

import {CHAPTER_TOOL_NAMES, chapterDisposition, chapterFromInput, isChapterTool} from "../src/lib/chapter-tool";
import {isInterruptedToolResult} from "../src/lib/tool-interruption";

const MCP = "mcp__ccd_session__mark_chapter";

function block(input: Record<string, unknown>, name = MCP) {
	return {id: "toolu_ch1", name, input};
}

describe("chapter tool classifier", () => {
	it("recognizes exactly upstream's two chapter tool names", () => {
		expect({
			names: [...CHAPTER_TOOL_NAMES],
			mcp: isChapterTool(MCP),
			markChapter: isChapterTool("MarkChapter"),
			suffixed: isChapterTool("mcp__ccd_session__mark_chapterx"),
			read: isChapterTool("Read"),
		}).toStrictEqual({
			names: [MCP, "MarkChapter"],
			mcp: true,
			markChapter: true,
			suffixed: false,
			read: false,
		});
	});

	it("builds a chapter with a trimmed title and summary, dropping an empty summary or a non-string title", () => {
		expect({
			full: chapterFromInput("toolu_ch1", {
				title: "  Staging refinement nodes ",
				summary: " Analyzed 5 inbox items ",
			}),
			blankSummary: chapterFromInput("toolu_ch2", {title: "Run tests", summary: "   "}),
			numericTitle: chapterFromInput("toolu_ch3", {title: 42}),
		}).toStrictEqual({
			full: {id: "toolu_ch1", title: "Staging refinement nodes", summary: "Analyzed 5 inbox items"},
			blankSummary: {id: "toolu_ch2", title: "Run tests"},
			numericTitle: {id: "toolu_ch3", title: ""},
		});
	});

	it("draws a heading for a successful, pending or interrupted call", () => {
		const input = {title: " Staging refinement nodes ", summary: " Analyzed 5 inbox items "};
		const heading = {
			kind: "heading",
			chapter: {id: "toolu_ch1", title: "Staging refinement nodes", summary: "Analyzed 5 inbox items"},
		};
		expect({
			success: chapterDisposition(block(input), {isError: false}),
			pending: chapterDisposition(block(input), undefined),
			markChapter: chapterDisposition(block({title: "Plan"}, "MarkChapter"), undefined),
			interrupted: chapterDisposition(block(input), {isError: true, interrupted: true}),
		}).toStrictEqual({
			success: heading,
			pending: heading,
			markChapter: {kind: "heading", chapter: {id: "toolu_ch1", title: "Plan"}},
			interrupted: heading,
		});
	});

	it("swallows a call with no title and turns a non-interrupt error into a failed tool row", () => {
		expect({
			blank: chapterDisposition(block({title: "  "}), undefined),
			numeric: chapterDisposition(block({title: 42}), {isError: false}),
			failed: chapterDisposition(block({title: "Plan"}), {isError: true}),
			notInterrupted: chapterDisposition(block({title: "Plan"}), {isError: true, interrupted: false}),
			blankError: chapterDisposition(block({title: ""}), {isError: true}),
		}).toStrictEqual({
			blank: {kind: "drop"},
			numeric: {kind: "drop"},
			failed: {kind: "failedTool"},
			notInterrupted: {kind: "failedTool"},
			blankError: {kind: "failedTool"},
		});
	});
});

const REJECTED =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const MEMORY_NOTE =
	"\n\nNote: The user's next message may contain a correction or preference. Pay close attention — if they explain what went wrong or how they'd prefer you to work, consider saving that to memory for future sessions.";
const STOPPED_WHILE_RUNNING = `${REJECTED} Correction to the text above: this call was stopped while running, not refused before it ran. It may have run in part or in full, and its changes may have been written. No permission prompt was involved. Work it started elsewhere (a remote command, a background process) may still be running, so check before starting the same work again. The instruction to stop and wait still stands.`;

describe("upstream vl's interrupted test", () => {
	it("reads an interrupted or cancelled denial kind and a lone 'User rejected tool use' result as interrupted", () => {
		expect({
			interruptedKind: isInterruptedToolResult({text: "Example error.", toolDenialKind: "interrupted"}),
			cancelledKind: isInterruptedToolResult({text: "Example error.", toolDenialKind: "cancelled"}),
			rejectedKind: isInterruptedToolResult({text: "Example error.", toolDenialKind: "user-rejected"}),
			userRejectedResult: isInterruptedToolResult({
				text: REJECTED,
				toolDenialKind: "user-rejected",
				toolUseResult: "User rejected tool use",
			}),
			userRejectedText: isInterruptedToolResult({text: "User rejected tool use"}),
			deniedByUser: isInterruptedToolResult({text: "Denied by user"}),
			plainError: isInterruptedToolResult({text: "Example error.", toolUseResult: "Error: Example error."}),
		}).toStrictEqual({
			interruptedKind: true,
			cancelledKind: true,
			rejectedKind: false,
			userRejectedResult: true,
			userRejectedText: false,
			deniedByUser: false,
			plainError: false,
		});
	});

	it("matches upstream's interrupt texts exactly, its ze notices and its Be stopped-while-running correction", () => {
		const texts = [
			"Tool execution was interrupted.",
			" Tool execution was interrupted.",
			"[Request interrupted by user for tool use]",
			"[Tool call did not complete: the turn was ended to deliver the message that follows. Nothing refused it; re-run it if still needed.]",
			"[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]",
			"[Tool call result not in this copy: this session was copied from another session before that session recorded this call's result. The call may have finished there, may still be running there, or may never have run. Check whether it took effect before relying on it or running it again.]",
			"[Tool call not completed: an approval request expired with no answer, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]",
			"[Tool call not completed: an approval request was still unanswered when the message that follows arrived and was closed, so the action awaiting approval did not run. Nobody refused it, so this is not the user's decision; ask again if it is still needed.]",
			"The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
			`The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.${MEMORY_NOTE}`,
			"[Tool call skipped: the turn ended to deliver the message that follows before this call ran. Nothing refused it; re-run it if still needed.]",
			"[Tool call skipped: the turn was stopped before this call ran, by the check whose denial is on another call in this batch. Nothing refused this call and it had no effects; re-run it if still needed.]",
			`${STOPPED_WHILE_RUNNING}\n`,
			`${STOPPED_WHILE_RUNNING}${MEMORY_NOTE}`,
			REJECTED,
		];
		expect(texts.map((text) => isInterruptedToolResult({text}))).toStrictEqual([
			true,
			false,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			false,
		]);
	});
});
