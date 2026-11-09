// @vitest-environment jsdom

import {beforeAll, describe, expect, it} from "vite-plus/test";

import {renderPreviewMarkdownToHtml} from "../src/lib/client-markdown";
import {loadPreviewSanitizer, parseOptionPreview} from "../src/lib/question-option-preview";

beforeAll(loadPreviewSanitizer);

describe("parseOptionPreview, as upstream's mU", () => {
	it("gives no preview for a missing, empty or blank value", () => {
		expect([undefined, null, "", "  \n ", 42].map(parseOptionPreview)).toStrictEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});

	it("normalizes CR and CRLF to LF in a text preview", () => {
		expect(parseOptionPreview("a\r\nb\rc")).toStrictEqual({kind: "text", text: "a\nb\nc"});
	});

	it("replaces invisible and control characters but keeps the legibility joiners", () => {
		expect(parseOptionPreview("a‮b\u0007c\u007Fd‍e‌f️\tg")).toStrictEqual({
			kind: "text",
			text: "a�b␇c␡d‍e‌f️\tg",
		});
	});

	it("ignores a tag inside a fenced code block", () => {
		expect(parseOptionPreview("```html\n<div>x</div>\n```")).toStrictEqual({
			kind: "text",
			text: "```html\n<div>x</div>\n```",
		});
	});

	it("ignores a tag inside a backtick span", () => {
		expect(parseOptionPreview("use `<div>`")).toStrictEqual({kind: "text", text: "use `<div>`"});
	});

	it("ignores a tag in indented code when another line is unindented", () => {
		const text = "Example:\n\n    <div>x</div>\n\nDone";
		expect(parseOptionPreview(text)).toStrictEqual({kind: "text", text});
	});

	it("ignores a tag outside upstream's tag set", () => {
		expect(parseOptionPreview("<foo>bar</foo>")).toStrictEqual({kind: "text", text: "<foo>bar</foo>"});
	});

	it("sanitizes an HTML preview", () => {
		expect(parseOptionPreview('<div style="color:red">x</div>')).toStrictEqual({
			kind: "html",
			sanitizedHtml: '<div style="color:red">x</div>',
		});
	});

	it("returns the same object for a repeated preview", () => {
		const text = "cached **once**";
		expect(parseOptionPreview(text)).toBe(parseOptionPreview(text));
	});
});

describe("HTML previews, as upstream's DOMPurify Oc", () => {
	function sanitized(html: string): string | undefined {
		const preview = parseOptionPreview(html);
		return preview?.kind === "html" ? preview.sanitizedHtml : undefined;
	}

	it("drops forbidden attributes and strips position and z-index from a style", () => {
		expect(sanitized('<div class="x" id="y" style="color:red;position:fixed;z-index:9">a</div>')).toBe(
			'<div style="color:red;">a</div>',
		);
	});

	it("makes a button inert", () => {
		expect(sanitized('<button onclick="x()">b</button>')).toBe('<button type="button" tabindex="-1">b</button>');
	});

	it("removes tags outside the allowlist", () => {
		expect(sanitized("<img src=x><script>1</script><p>ok</p>")).toBe("<p>ok</p>");
	});

	it("drops a style calling a function outside the allowlist", () => {
		expect(sanitized('<div style="background:url(x)">a</div>')).toBe("<div>a</div>");
	});

	it("keeps a style calling an allowed function", () => {
		expect(sanitized('<div style="color:rgb(1, 2, 3)">a</div>')).toBe('<div style="color:rgb(1, 2, 3)">a</div>');
	});

	it("drops a style with a comment or a backslash", () => {
		expect([
			sanitized('<div style="color:/* x */red">a</div>'),
			sanitized('<div style="color:\\72 ed">a</div>'),
		]).toStrictEqual(["<div>a</div>", "<div>a</div>"]);
	});

	it("drops a style over 4096 characters", () => {
		expect(sanitized(`<div style="color:red;${"a".repeat(4096)}">a</div>`)).toBe("<div>a</div>");
	});

	it("strips font, content and quoted list-style declarations", () => {
		expect(sanitized(`<div style="font-family:x;font:12px y;content:'z';list-style:'-';color:red">a</div>`)).toBe(
			'<div style="color:red">a</div>',
		);
	});

	it("gives no preview when the HTML sanitizes to nothing", () => {
		expect(parseOptionPreview("<script>alert(1)</script><img src=x>")).toBeUndefined();
	});
});

describe("renderPreviewMarkdownToHtml, as upstream's PreviewMarkdown", () => {
	it("renders URLs and links as plain text", () => {
		expect(renderPreviewMarkdownToHtml("see https://example.com and [docs](https://example.com/docs)")).toBe(
			"<p>see https://example.com and docs</p>\n",
		);
	});

	it("renders fences, mermaid included, as bare code blocks without a header or copy button", () => {
		expect(renderPreviewMarkdownToHtml("```mermaid\ngraph TD\n```")).toBe(
			'<pre><code class="language-mermaid">graph TD\n</code></pre>\n',
		);
	});

	it("escapes raw HTML", () => {
		expect(renderPreviewMarkdownToHtml("**a** <b>")).toBe("<p><strong>a</strong> &lt;b&gt;</p>\n");
	});
});
