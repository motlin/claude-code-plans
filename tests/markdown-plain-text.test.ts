import {describe, expect, it} from "vite-plus/test";

import {markdownToPlainText} from "../src/lib/markdown-plain-text";

describe("markdownToPlainText", () =>
{
	it("drops markers, link targets and fences and keeps block breaks", () =>
	{
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

	it("drops a drawable mermaid fence unless its source is shown (upstream cb6930dae pd)", () =>
	{
		const token = `ghp_${"x".repeat(36)}`;
		const markdown = [
			"Before",
			"",
			"```Mermaid",
			"graph TD; A-->B",
			"```",
			"",
			"```mermaid",
			`graph TD; A[${token}]-->B`,
			"```",
			"",
			"```mermaid",
			"graph LR; C-->D",
			"```",
		].join("\n");
		const asked: string[] = [];
		const text = markdownToPlainText(
			markdown,
			{
				mermaidSourceShown: (code) =>
				{
					asked.push(code);
					return code === "graph LR; C-->D";
				},
			},
		);
		expect(
			{
				text,
				asked,
				withoutDiagrams: markdownToPlainText(markdown),
			},
		).toStrictEqual(
			{
				text: ["Before", "", "", "", `graph TD; A[${token}]-->B`, "", "graph LR; C-->D"].join("\n"),
				asked: ["graph TD; A-->B", "graph LR; C-->D"],
				withoutDiagrams: [
					"Before",
					"",
					"graph TD; A-->B",
					"",
					`graph TD; A[${token}]-->B`,
					"",
					"graph LR; C-->D",
				].join("\n"),
			},
		);
	});
});
