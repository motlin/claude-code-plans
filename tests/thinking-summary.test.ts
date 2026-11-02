import {describe, expect, it} from "vite-plus/test";
import {thinkingStepLabel, thinkingSummary} from "../src/lib/thinking-summary";

describe("thinkingSummary", () =>
{
	it.each([
		["skips blank lines and trims the first content line", "\n\n  First line here\nSecond", "First line here"],
		["skips a whole-line fence instead of stripping it in place", "```ts\nconst x = 1\n```", "const x = 1"],
		["drops a leading heading marker", "## Plan the work", "Plan the work"],
		["drops a leading bullet", "- item one", "item one"],
		["drops a leading ordered-list marker", "12. step", "step"],
		["drops a quote marker and emphasis stars", "> quoted **bold** text", "quoted bold text"],
		["drops backticks and keeps link text", "Use `foo` and [the docs](https://x.y/z)", "Use foo and the docs"],
		["keeps underscores", "snake_case_name", "snake_case_name"],
		["splits on newline only and trims the trailing CR", "line one\r\nline two", "line one"],
		["cuts a line over 200 units and appends an ellipsis", "a".repeat(250), `${"a".repeat(200)}…`],
		["drops a high surrogate dangling at the cut", `${"a".repeat(199)}\u{1F600}x`, `${"a".repeat(199)}…`],
		["keeps a line of exactly 200 units", "b".repeat(200), "b".repeat(200)],
	])("%s", (_name, text, expected) =>
	{
		expect(thinkingSummary(text)).toStrictEqual(expected);
	});

	it.each([
		["only markers, an invisible line and fences", "**\n​\n```\n"],
		["only whitespace", "   "],
		["empty", ""],
	])("has no summary for %s", (_name, text) =>
	{
		expect(thinkingSummary(text)).toBeUndefined();
	});
});

describe("thinkingStepLabel", () =>
{
	it("is the summary line when there is one", () =>
	{
		expect(thinkingStepLabel("## Weighing options\nmore")).toBe("Weighing options");
	});

	it("falls back to Thinking… when no line has content", () =>
	{
		expect(thinkingStepLabel("**")).toBe("Thinking…");
	});
});
