import {describe, expect, it} from "vite-plus/test";

import {formatDiffAnnotations} from "../src/lib/context-attach";
import {parseDiffAnnotations} from "../src/lib/diff-annotation-markers";
import {LIVE_PROMPT, LONG_BODY, LONG_PATH} from "./diff-annotation-fixtures";

describe("parseDiffAnnotations", () =>
{
	it("splits upstream's live comment blocks out of a prompt, keeping the rest as text", () =>
	{
		expect(parseDiffAnnotations(LIVE_PROMPT)).toStrictEqual(
			{
				annotations: [
					{
						filePath: "src/demo.ts",
						startLine: 3,
						endLine: undefined,
						oldSide: false,
						code: "const answer = 42;",
						lang: "ts",
						body: "Rename this constant to something clearer",
					},
					{
						filePath: "src/demo.ts",
						startLine: 5,
						endLine: 7,
						oldSide: true,
						code: "- removedA();\n- removedB();\n- removedC();",
						lang: "ts",
						body: LONG_BODY,
					},
					{
						filePath: LONG_PATH,
						startLine: 120,
						endLine: undefined,
						oldSide: false,
						code: '<div className="x" />',
						lang: "tsx",
						body: "",
					},
				],
				rest: "[upstream-sync test] Reply with only the word ok. Do nothing else: no tools, no files, no commands.\n\nThanks",
			},
		);
	});

	it("leaves a prompt with fences but no In header untouched", () =>
	{
		const prompt = "Look at this:\n```js\nconst x = 1;\n```\nThoughts?";
		expect(parseDiffAnnotations(prompt)).toStrictEqual(
			{
				annotations: [],
				rest: prompt,
			},
		);
	});

	it("keeps a plain fence after an annotation's body as prompt text", () =>
	{
		expect(
			parseDiffAnnotations("In `a.ts` at line 1:\n```\nx\n```\nFix\n\n\nAlso see:\n```sh\nls\n```\nok"),
		).toStrictEqual(
			{
				annotations: [
					{
						filePath: "a.ts",
						startLine: 1,
						endLine: undefined,
						oldSide: false,
						code: "x",
						lang: "text",
						body: "Fix",
					},
				],
				rest: "Also see:\n\n```sh\nls\n```\n\nok",
			},
		);
	});

	it("stores a suggestion fence right after an annotation instead of showing it", () =>
	{
		expect(
			parseDiffAnnotations("In `a.ts` at line 2:\n```ts\nold();\n```\n```suggestion\nnew();\n```\nPlease"),
		).toStrictEqual(
			{
				annotations: [
					{
						filePath: "a.ts",
						startLine: 2,
						endLine: undefined,
						oldSide: false,
						code: "old();",
						lang: "ts",
						body: "Please",
						suggestion: "new();",
					},
				],
				rest: "",
			},
		);
	});

	it("round-trips the local serializer's output", () =>
	{
		const sent = formatDiffAnnotations(
			[
				{
					path: "src/demo.ts",
					side: "additions",
					line: 3,
					text: "Rename",
					snippet: "const answer = 42;",
					lang: "ts",
				},
				{
					path: "src/demo.ts",
					side: "deletions",
					line: 5,
					endLine: 7,
					text: "Why?",
					snippet: "a();\nb();\nc();",
				},
			],
			"Go",
		);
		expect(parseDiffAnnotations(sent)).toStrictEqual(
			{
				annotations: [
					{
						filePath: "src/demo.ts",
						startLine: 3,
						endLine: undefined,
						oldSide: false,
						code: "const answer = 42;",
						lang: "ts",
						body: "Rename",
					},
					{
						filePath: "src/demo.ts",
						startLine: 5,
						endLine: 7,
						oldSide: true,
						code: "a();\nb();\nc();",
						lang: "text",
						body: "Why?",
					},
				],
				rest: "Go",
			},
		);
	});
});
