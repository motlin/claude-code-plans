import {describe, expect, it} from "vite-plus/test";

import {chapterFor, forkPointFor} from "../src/lib/transcript-action-targets";
import {processTranscript} from "../src/lib/transcript";

const RECORDS: unknown[] = [
	{type: "user", uuid: "prompt-1", message: {role: "user", content: "Set up the repository for the new service"}},
	{
		type: "assistant",
		uuid: "reply-1",
		parentUuid: "prompt-1",
		message: {role: "assistant", content: [{type: "text", text: "## Done\n\nThe repo is **ready** to go."}]},
	},
	{
		type: "user",
		uuid: "prompt-2",
		parentUuid: "reply-1",
		message: {
			role: "user",
			content:
				"Now write a very long follow-up prompt that goes on and on well past the chapter label length limit",
		},
	},
	{
		type: "assistant",
		uuid: "tools-1",
		parentUuid: "prompt-2",
		message: {
			role: "assistant",
			content: [{type: "tool_use", id: "toolu_1", name: "Bash", input: {command: "ls"}}],
		},
	},
];

const {lines} = processTranscript(RECORDS, 10);

describe("forkPointFor", () => {
	it("forks an assistant message at itself and a prompt at the message before it", () => {
		expect({
			assistant: forkPointFor(lines, "reply-1"),
			prompt: forkPointFor(lines, "prompt-2"),
			firstPrompt: forkPointFor(lines, "prompt-1"),
			unknown: forkPointFor(lines, "not-loaded"),
		}).toStrictEqual({
			assistant: "reply-1",
			prompt: "reply-1",
			firstPrompt: "prompt-1",
			unknown: "not-loaded",
		});
	});
});

describe("chapterFor", () => {
	it("labels a chapter with the message's first line of plain text, clipped, at its record index", () => {
		expect({
			reply: chapterFor(lines, "reply-1"),
			prompt: chapterFor(lines, "prompt-2"),
			tools: chapterFor(lines, "tools-1"),
			unknown: chapterFor(lines, "not-loaded"),
		}).toStrictEqual({
			reply: {uuid: "reply-1", label: "Done", recordIndex: 11},
			prompt: {
				uuid: "prompt-2",
				label: "Now write a very long follow-up prompt that goes on and on…",
				recordIndex: 12,
			},
			tools: {uuid: "tools-1", label: "Tool calls", recordIndex: 13},
			unknown: null,
		});
	});
});
