import {describe, expect, it} from "vite-plus/test";
import {paramValueText} from "../src/lib/param-value-text";
import {revealControlChars, revealSpoofing, visibleSingleLine} from "../src/lib/visible-text";

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

describe("revealControlChars, as upstream's Jr (shared-0)", () => {
	it("tags C0 and C1 controls and line separators, keeping tab, newline, a CRLF's CR and bidi controls", () => {
		const rlo = String.fromCodePoint(0x202e);
		expect(revealControlChars(`a\u0007b\u001b[31mc\u0085d\u2028e\rf\r\ng\th${rlo}i\nj`)).toStrictEqual(
			`a[U+0007]b[U+001B][31mc[U+0085]d[U+2028]e[U+000D]f\r\ng\th${rlo}i\nj`,
		);
	});
});

describe("paramValueText, as upstream's c62da1b56 R (the param row value)", () => {
	const token = `ghp_${"A".repeat(36)}`;
	const masked = `ghp_AAAA${"\u2022".repeat(32)}`;

	it("leaves a secret in text without controls for the renderer to cloak", () => {
		expect(paramValueText(`use ${token}`)).toStrictEqual(`use ${token}`);
	});

	it("only tags the controls of text without a secret", () => {
		expect(paramValueText("a\u001b[31mred\u0007")).toStrictEqual("a[U+001B][31mred[U+0007]");
	});

	it("masks a secret in text with controls in place, the escape sequences stripped and listed on their own lines", () => {
		expect(paramValueText(`\u001b[31m${token}\u001b[0m and\u0007`)).toStrictEqual(
			`${masked} and[U+0007]\n[U+001B][31m\n[U+001B][0m`,
		);
	});
});
