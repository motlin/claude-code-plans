import {describe, expect, it} from "vite-plus/test";
import {revealSpoofing, visibleSingleLine} from "../src/lib/visible-text";

describe("visibleSingleLine", () => {
	it.each([
		{name: "plain text", text: "Bash(npm run *)", shown: "Bash(npm run *)"},
		{name: "newlines and tabs", text: "echo a\nb\tc\r\n", shown: "echo a[U+000A]b[U+0009]c[U+000D][U+000A]"},
		{name: "control characters", text: "a\u0000b\u007fc\u009f", shown: "a[U+0000]b[U+007F]c[U+009F]"},
		{name: "bidi controls", text: "ls ‮txt.exe⁦", shown: "ls [U+202E]txt.exe[U+2066]"},
		{name: "zero-width and format characters", text: "a​b﻿c­d", shown: "a[U+200B]b[U+FEFF]c[U+00AD]d"},
		{name: "odd spaces, keeping the plain space", text: "a b c　d⠀e", shown: "a b[U+00A0]c[U+3000]d[U+2800]e"},
		{name: "line and paragraph separators", text: "a b c", shown: "a[U+2028]b[U+2029]c"},
		{name: "private-use and lone surrogates", text: "ab\uD800c", shown: "a[U+E000]b[U+D800]c"},
		{name: "a literal escape lookalike", text: "[U+0041] and [x]", shown: "[U+005B]U+0041] and [x]"},
		{name: "a backslash escape naming an invisible character", text: "\\u200b", shown: "[U+005C]u200b"},
		{name: "a backslash escape naming a visible character", text: "\\u0041 \\n", shown: "\\u0041 \\n"},
		{name: "emoji and other scripts", text: "✅ שלום 日本", shown: "✅ שלום 日本"},
	])("shows $name", ({text, shown}) => {
		expect(visibleSingleLine(text)).toStrictEqual(shown);
	});
});

describe("revealSpoofing, as upstream's u9", () => {
	it("tags spoofing characters, keeps keycaps and lone invisibles, and tags runs of odd blanks on a drawn line", () => {
		expect(
			[
				"plain text",
				"a\u202Eb",
				"1\uFE0F\u20E3 x",
				"a\u200Bb",
				"a\u200B\u200B\u200Bb",
				`a${"\u200Bb".repeat(17)}`,
				"x\u3000\u3000\u3000y",
				"\u3000\u3000\u3000",
			].map(revealSpoofing),
		).toStrictEqual([
			"plain text",
			"a[U+202E]b",
			"1\uFE0F\u20E3 x",
			"a\u200Bb",
			"a[U+200B][U+200B][U+200B]b",
			`a${"[U+200B]b".repeat(17)}`,
			"x[U+3000][U+3000][U+3000]y",
			"\u3000\u3000\u3000",
		]);
	});
});
