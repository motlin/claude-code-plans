import {describe, expect, it} from "vite-plus/test";
import {clipFirstLine, excerptRowName, replyPreviewText, replyTileName} from "../src/lib/reply-tile-name";

describe("reply tile name (upstream za/wr)", () =>
{
	it("clips each part's first line to 39 chars and an ellipsis, in curly quotes", () =>
	{
		expect(
			replyTileName(
				"The build step runs vitest first and then the typecheck.",
				"Swap these so the typecheck fails fast",
			),
		).toBe("Your reply to “The build step runs vitest first and th…”: Swap these so the typecheck fails fast");
	});

	it("uses the first non-blank line, trimmed", () =>
	{
		expect(replyTileName("\n  first line\nsecond", "ok")).toBe("Your reply to “first line”: ok");
	});

	it("keeps a 40-char line whole and never splits a surrogate pair at the cut", () =>
	{
		const forty = "a".repeat(40);
		const straddling = `${"a".repeat(38)}😀${"b".repeat(5)}`;
		expect(
			{
				forty: clipFirstLine(forty),
				straddling: clipFirstLine(straddling),
			},
		).toStrictEqual(
			{
				forty,
				straddling: `${"a".repeat(38)}…`,
			},
		);
	});

	it("previews every quote line with > , a blank line, then the comment", () =>
	{
		expect(replyPreviewText("one\r\ntwo", "fix")).toBe("> one\n> two\n\nfix");
	});

	it("names a plain Excerpt row after upstream's unit list of the badge and the clipped first line", () =>
	{
		expect(
			{
				short: excerptRowName("Plain excerpt without a comment"),
				long: excerptRowName(`\n  ${"x".repeat(60)}\nsecond`),
			},
		).toStrictEqual(
			{
				short: "Excerpt, Plain excerpt without a comment",
				long: `Excerpt, ${"x".repeat(39)}…`,
			},
		);
	});
});
