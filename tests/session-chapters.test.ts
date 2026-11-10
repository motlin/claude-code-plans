import {describe, expect, it} from "vite-plus/test";

import {appendClaudeChapters, extractClaudeChapters} from "../src/lib/session-chapters";

function chapterCall(
	uuid: string,
	id: string,
	input: Record<string, unknown>,
	name = "mcp__ccd_session__mark_chapter",
) {
	return {type: "assistant", uuid, message: {role: "assistant", content: [{type: "tool_use", id, name, input}]}};
}

function result(uuid: string, id: string, content: string, isError = false) {
	return {
		type: "user",
		uuid,
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
