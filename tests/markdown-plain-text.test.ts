import {describe, expect, it} from "vite-plus/test";

import {markdownToPlainText} from "../src/lib/markdown-plain-text";

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
