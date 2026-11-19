import {describe, expect, it} from "vite-plus/test";

import {mermaidSourceKey} from "../src/lib/mermaid-find";
import {chapterFor, chapterTitle, forkPointFor, messageSearchText} from "../src/lib/transcript-action-targets";
import type {MessageSessionLine} from "../src/lib/transcript";
import {processTranscript} from "../src/lib/transcript";

const RECORDS: unknown[] = [
	{
		type: "user",
		uuid: "prompt-1",
		message:
		{
			role: "user",
			content: "Set up the repository for the new service",
		},
	},
	{
		type: "assistant",
		uuid: "reply-1",
		parentUuid: "prompt-1",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: "## Done\n\nThe repo is **ready** to go.",
				},
			],
		},
	},
	{
		type: "user",
		uuid: "prompt-2",
		parentUuid: "reply-1",
		message:
		{
			role: "user",
			content:
				"Now write a very long follow-up prompt that goes on and on well past the chapter label length limit",
		},
	},
	{
		type: "assistant",
		uuid: "tools-1",
		parentUuid: "prompt-2",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_1",
					name: "Bash",
					input:
					{
						command: "ls",
					},
				},
			],
		},
	},
];

const {lines} = processTranscript(RECORDS, 10);

describe("forkPointFor", () =>
{
	it("forks an assistant message at itself and a prompt at the message before it", () =>
	{
		expect(
			{
				assistant: forkPointFor(lines, "reply-1"),
				prompt: forkPointFor(lines, "prompt-2"),
				firstPrompt: forkPointFor(lines, "prompt-1"),
				unknown: forkPointFor(lines, "not-loaded"),
			},
		).toStrictEqual(
			{
				assistant: "reply-1",
				prompt: "reply-1",
				firstPrompt: "prompt-1",
				unknown: "not-loaded",
			},
		);
	});
});

describe("chapterFor", () =>
{
	it("titles a chapter with the message's first line of plain text at its record index", () =>
	{
		expect(
			{
				reply: chapterFor(lines, "reply-1"),
				prompt: chapterFor(lines, "prompt-2"),
				tools: chapterFor(lines, "tools-1"),
				unknown: chapterFor(lines, "not-loaded"),
			},
		).toStrictEqual(
			{
				reply:
				{
					afterId: "reply-1",
					title: "Done",
					recordIndex: 11,
				},
				prompt:
				{
					afterId: "prompt-2",
					title: "Now write a very long follow-up prompt t…",
					recordIndex: 12,
				},
				tools:
				{
					afterId: "tools-1",
					title: "Tool calls",
					recordIndex: 13,
				},
				unknown: null,
			},
		);
	});
});

describe("chapterTitle", () =>
{
	it("cuts the first non-empty line at upstream's 40 characters, with an ellipsis only when it was longer", () =>
	{
		const forty = "a".repeat(40);
		expect(
			{
				forty: chapterTitle(forty),
				fortyOne: chapterTitle(`${forty}b`),
				skipsBlankLines: chapterTitle("\n  \n  Second line  \nThird"),
				blank: chapterTitle("  \n "),
			},
		).toStrictEqual(
			{
				forty,
				fortyOne: `${forty}…`,
				skipsBlankLines: "Second line",
				blank: "",
			},
		);
	});
});

describe("messageSearchText", () =>
{
	const MERMAID = "```mermaid\ngraph TD; A-->B\n```";
	const {lines: mermaidLines} = processTranscript(
		[
			{
				type: "user",
				uuid: "ask",
				message:
				{
					role: "user",
					content: `Draw it\n\n${MERMAID}`,
				},
			},
			{
				type: "assistant",
				uuid: "draw",
				parentUuid: "ask",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: `Here:\n\n${MERMAID}`,
						},
						{
							type: "tool_use",
							id: "toolu_m",
							name: "Bash",
							input:
							{
								command: "ls",
							},
						},
						{
							type: "text",
							text: MERMAID,
						},
					],
				},
			},
		],
		10,
	);
	const message = (uuid: string) =>
		mermaidLines.find((line): line is MessageSessionLine => "uuid" in line && line.uuid === uuid)!;

	it("drops a reply's drawn mermaid fences unless the find store reports that block's source shown (upstream ECe + sd)", () =>
	{
		const shown = new Set([mermaidSourceKey("draw:2", "graph TD; A-->B")]);
		const asked: string[] = [];
		const isShown = (key: string) =>
		{
			asked.push(key);
			return shown.has(key);
		};
		expect(
			{
				reply: messageSearchText(message("draw"), isShown),
				prompt: messageSearchText(message("ask"), isShown),
				asked,
			},
		).toStrictEqual(
			{
				reply: "Here:\n\n\n\ngraph TD; A-->B",
				prompt: "Draw it\n\ngraph TD; A-->B",
				asked: ["draw:0\ngraph TD; A-->B", "draw:2\ngraph TD; A-->B"],
			},
		);
	});
});
