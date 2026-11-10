import {describe, expect, it} from "vite-plus/test";

import {CHAPTER_TOOL_NAMES, chapterDisposition, chapterFromInput, isChapterTool} from "../src/lib/chapter-tool";

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
			success: chapterDisposition(block(input), {
				result: 'Chapter marked: "Staging refinement nodes". Continue your current work.',
				isError: false,
			}),
			pending: chapterDisposition(block(input), undefined),
			markChapter: chapterDisposition(block({title: "Plan"}, "MarkChapter"), undefined),
			interrupted: chapterDisposition(block(input), {result: "Tool execution was interrupted.", isError: true}),
			requestInterrupted: chapterDisposition(block(input), {
				result: "[Request interrupted by user for tool use]",
				isError: true,
			}),
			userRejected: chapterDisposition(block(input), {result: "User rejected tool use", isError: true}),
		}).toStrictEqual({
			success: heading,
			pending: heading,
			markChapter: {kind: "heading", chapter: {id: "toolu_ch1", title: "Plan"}},
			interrupted: heading,
			requestInterrupted: heading,
			userRejected: heading,
		});
	});

	it("swallows a call with no title and turns a non-interrupt error into a failed tool row", () => {
		expect({
			blank: chapterDisposition(block({title: "  "}), undefined),
			numeric: chapterDisposition(block({title: 42}), {result: "ok", isError: false}),
			denied: chapterDisposition(block({title: "Plan"}), {result: "Denied by user", isError: true}),
			boom: chapterDisposition(block({title: "Plan"}), {result: "boom", isError: true}),
			blankError: chapterDisposition(block({title: ""}), {result: "boom", isError: true}),
		}).toStrictEqual({
			blank: {kind: "drop"},
			numeric: {kind: "drop"},
			denied: {kind: "failedTool"},
			boom: {kind: "failedTool"},
			blankError: {kind: "failedTool"},
		});
	});
});
