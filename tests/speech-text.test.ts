import {describe, expect, it} from "vite-plus/test";
import {speechText} from "../src/lib/speech-text";

describe("speechText", () => {
	it("prepares markdown as upstream does before reading it aloud", () => {
		const markdown = [
			"# Example **plan** for _the_ `src/a.ts` file",
			"",
			"See [the docs](https://example.com/docs) and ![a diagram](diagram.png).",
			"",
			"```ts",
			"const a = 1;",
			"```",
			"",
			"",
			"",
			"| Name | Value |",
			"|:-----|------:|",
			"| one | 1 |",
			"",
			"Visit https://example.com/a_b or ~/projects/example/src/a.ts, ***now*** __please__ snake_case_name.",
		].join("\n");

		expect(speechText(markdown)).toBe(
			[
				"Example plan for the src/a.ts file",
				"",
				"See the docs and a diagram.",
				"",
				" (code block) ",
				"",
				"  Name   Value  ",
				"",
				"  one   1  ",
				"",
				"Visit https://example.com/a_b or ~/projects/example/src/a.ts, now please snake_case_name.",
			].join("\n"),
		);
	});

	it("is empty for whitespace-only markdown", () => {
		expect(speechText("\n\n  \n")).toBe("");
	});
});
