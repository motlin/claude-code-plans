import {describe, expect, it} from "vite-plus/test";

import {markdownToPlainText, markdownToSpeechText} from "../src/lib/markdown-plain-text";

describe("markdownToPlainText", () => {
	it("drops markers, link targets and fences and keeps block breaks", () => {
		expect(
			markdownToPlainText(
				[
					"# Title",
					"",
					"Some **bold** `code` and [a link](https://example.com).",
					"",
					"- one",
					"- two",
					"",
					"| a | b |",
					"|---|---|",
					"| 1 | 2 |",
					"",
					"```ts",
					"const x = 1;",
					"```",
				].join("\n"),
			),
		).toStrictEqual(
			["Title", "", "Some bold code and a link.", "", "one", "two", "", "a\tb", "1\t2", "", "const x = 1;"].join(
				"\n",
			),
		);
	});
});

describe("markdownToSpeechText", () => {
	it("says a fenced or indented code block as a short placeholder", () => {
		expect(
			markdownToSpeechText("Run this:\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nThen this:\n\n    npm test\n"),
		).toBe("Run this:\n\ncode block\n\nThen this:\n\ncode block");
	});

	it("says a path by its file name and a URL as link, in prose, inline code and link text alike", () => {
		expect(
			markdownToSpeechText(
				[
					"Edited `/Users/alice/projects/app/src/lib/speech.ts` and src/components/chat-view.tsx, see https://example.com/a/b?c=1.",
					"",
					"Open [https://github.com/alice/app/pull/12](https://github.com/alice/app/pull/12) or [the docs](https://example.com/docs).",
					"",
					"Paths like ~/notes/today.md, ./build.sh and ../up/two/levels stay short; and/or stays as written.",
				].join("\n"),
			),
		).toBe(
			[
				"Edited speech.ts and chat-view.tsx, see link.",
				"",
				"Open link or the docs.",
				"",
				"Paths like today.md, build.sh and levels stay short; and/or stays as written.",
			].join("\n"),
		);
	});
});
