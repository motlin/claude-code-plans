import {describe, expect, it} from "vite-plus/test";
import {prettyJson} from "../src/lib/pretty-json";
import {classifyToolBody, isColumns, sniffMarkdown} from "../src/lib/tool-body-kind";

/** A fake GitHub-token-shaped value, built at runtime so no secret-shaped literal lands in the repo. */
const FAKE_GH = `ghp_${"A".repeat(36)}`;

describe("prettyJson (upstream Kg + qg)", () => {
	it("indents two spaces, spaces each colon, keeps empty containers inline and copies strings verbatim", () => {
		expect({
			nested: prettyJson('{"a":[1,2],"b":{},"c":"x, y: z"}'),
			emptyArray: prettyJson("[ ]"),
			escapedQuote: prettyJson('{"q":"a\\"b"}'),
			unicodeEscape: prettyJson('{"u":"\\u00e9"}'),
			invalid: prettyJson("{bad"),
			notJson: prettyJson("hello"),
			padded: prettyJson('  {"a": 1}\n'),
		}).toStrictEqual({
			nested: '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {},\n  "c": "x, y: z"\n}',
			emptyArray: "[]",
			escapedQuote: '{\n  "q": "a\\"b"\n}',
			unicodeEscape: '{\n  "u": "\\u00e9"\n}',
			invalid: undefined,
			notJson: undefined,
			padded: '{\n  "a": 1\n}',
		});
	});

	it("gives up past 1e5 characters", () => {
		expect(prettyJson(`[${"1,".repeat(50_000)}1]`)).toBeUndefined();
	});
});

describe("sniffMarkdown (upstream Xg)", () => {
	it("accepts a table delimiter, bold, an http link, a closed fence, or an h2+ heading with a bullet", () => {
		const yes = ["| a | b |\n|---|---|", "x **bold** y", "[t](https://e.com)", "```js\nx\n```", "## H\n- item"];
		const no = ["# H\n- item", "## H\ntext", "a**b**c", "[t](./rel)", "```js\nx"];
		expect({yes: yes.map(sniffMarkdown), no: no.map(sniffMarkdown)}).toStrictEqual({
			yes: [true, true, true, true, true],
			no: [false, false, false, false, false],
		});
	});
});

describe("isColumns (upstream Qg)", () => {
	it("needs two lines with an interior run of 2+ spaces or a tab, or a leading indent", () => {
		expect([
			isColumns("NAME  X\nfoo   y"),
			isColumns("  a\n  b"),
			isColumns("a\tb\nc\td"),
			isColumns("a  b\nc"),
		]).toStrictEqual([true, true, true, false]);
	});
});

describe("classifyToolBody (upstream o_)", () => {
	it("prefers JSON, then markdown when allowed, then text with a columns flag", () => {
		expect({
			json: classifyToolBody('{"ok":true}', {allowMarkdown: true}),
			markdown: classifyToolBody("## H\n- i", {allowMarkdown: true}),
			markdownOff: classifyToolBody("## H\n- i", {allowMarkdown: false}),
			columns: classifyToolBody("NAME  X\nfoo   y", {allowMarkdown: true}),
			text: classifyToolBody("hello", {allowMarkdown: true}),
		}).toStrictEqual({
			json: {kind: "json", text: '{\n  "ok": true\n}', tile: true},
			markdown: {kind: "markdown", text: "## H\n- i"},
			markdownOff: {kind: "text", text: "## H\n- i", columns: false},
			columns: {kind: "text", text: "NAME  X\nfoo   y", columns: true},
			text: {kind: "text", text: "hello", columns: false},
		});
	});

	it("drops the tile past 2000 pretty lines or when the JSON holds a secret", () => {
		const long = JSON.stringify(Array.from({length: 2000}, (_, i) => i));
		const secret = JSON.stringify({token: FAKE_GH});
		expect({
			longTile: classifyToolBody(long, {allowMarkdown: true}),
			secret: classifyToolBody(secret, {allowMarkdown: true}),
		}).toStrictEqual({
			longTile: {kind: "json", text: prettyJson(long), tile: false},
			secret: {kind: "json", text: `{\n  "token": "${FAKE_GH}"\n}`, tile: false},
		});
	});

	it("keeps markdown with math, ANSI escapes or a secret as text, and strips cc-memory tags before sniffing", () => {
		expect({
			math: classifyToolBody("## H\n- $$x$$", {allowMarkdown: true}),
			ansi: classifyToolBody("\u001b[1m**bold**\u001b[0m", {allowMarkdown: true}),
			secret: classifyToolBody(`**key** ${FAKE_GH}`, {allowMarkdown: true}),
			memory: classifyToolBody("<cc-memory id='m'>**bold**</cc-memory>", {allowMarkdown: true}),
		}).toStrictEqual({
			math: {kind: "text", text: "## H\n- $$x$$", columns: false},
			ansi: {kind: "text", text: "\u001b[1m**bold**\u001b[0m", columns: false},
			secret: {kind: "text", text: `**key** ${FAKE_GH}`, columns: false},
			memory: {kind: "markdown", text: "<cc-memory id='m'>**bold**</cc-memory>"},
		});
	});
});
