// @vitest-environment jsdom

import {getSingularPatch} from "@pierre/diffs";
import type {FileDiffMetadata} from "@pierre/diffs";
import {describe, expect, it} from "vite-plus/test";
import {
	HUNK_HEADING_CSS,
	adoptHunkHeadingCss,
	decorateHunkHeadings,
	hunkHeading,
} from "../src/components/changes/diff-hunk-heading";

/** One file's patch with a single `@@ -14 +14 @@ <ctx>` hunk; the counts follow the lines. */
function patchOf(name: string, ctx: string | undefined, lines: readonly string[], start = 14): string {
	const old = lines.filter((line) => !line.startsWith("+")).length;
	const neu = lines.filter((line) => !line.startsWith("-")).length;
	const header = `@@ -${start},${old} +${start},${neu} @@${ctx === undefined ? "" : ` ${ctx}`}`;
	return [`--- a/${name}`, `+++ b/${name}`, header, ...lines, ""].join("\n");
}

function fileDiffOf(name: string, ctx: string | undefined, lines: readonly string[]): FileDiffMetadata {
	return getSingularPatch(patchOf(name, ctx, lines));
}

const IND = ["   a", "-  b", "+  B", "   c"];

describe("hunkHeading", () => {
	it("ports upstream c91a5e4a6 h over the table verified live upstream", () => {
		const rows: [string, string | undefined, readonly string[], string | undefined][] = [
			["a.ts", "function foo() {", IND, "function foo() {"],
			["a.css", ".btn {", IND, undefined],
			["a.scss", "@media x {", IND, undefined],
			["a.rb", "end", IND, undefined],
			["a.sh", "fi", IND, undefined],
			["a.sh", "  done", IND, undefined],
			["a.cpp", "public:", IND, undefined],
			["a.yml", "public:", IND, "public:"],
			["Makefile", "private:", IND, "private:"],
			["README.md", "Some prose here", IND, undefined],
			["notes.txt", "Chapter one", IND, undefined],
			["LICENSE", "Copyright", IND, undefined],
			["README.md", "## Install", IND, "## Install"],
			["docs/x.md", "## Install", [" ## Usage", "-  b", "+  B", "   c"], undefined],
			["a.ts", "{", IND, "{"],
			["a.py", "    def foo(self):", IND, "def foo(self):"],
			["a.ts", undefined, IND, undefined],
			["a.ts", "function foo() {", [" function bar() {", "-  b", "+  B", "   c"], undefined],
			["a.ts", "function foo() {", ["   a", "-  b", "+bar()", "   c"], undefined],
			["a.ts", "function foo() {", ["   a", "-baz()", "   c"], undefined],
			["a.ts", "function foo() {", ["   a", "-baz()", "+  q", "   c"], "function foo() {"],
			[
				"a.ts",
				"function foo() {",
				["   a", "-  b", "+  B", "   c", " zed()", "-  y", "+  Y"],
				"function foo() {",
			],
			["a.ts", "# not md", IND, "# not md"],
			["a.md", "#tag", IND, "#tag"],
			["a.ts", "xxxxx  trailing  ", IND, "xxxxx  trailing"],
		];
		const actual = rows.map(([name, ctx, lines]) => {
			const fileDiff = fileDiffOf(name, ctx, lines);
			const hunk = fileDiff.hunks[0];
			if (!hunk) throw new Error(`no hunk for ${name}`);
			return [name, ctx, lines, hunkHeading(fileDiff, hunk)];
		});
		expect(actual).toStrictEqual(rows);
	});
});

const LABEL = "13 unmodified lines";

/** A separator followed by the first row of the hunk below it, as pierre renders it. */
function separator(label: string, nextNumber: number, nextType: string): string {
	return `<div data-separator="line-info"><div data-separator-wrapper><div data-separator-content><span data-unmodified-lines>${label}</span></div></div></div><div data-column-number="${nextNumber}" data-line-type="${nextType}"></div>`;
}

const TWO_HUNKS = [
	"--- a/a.ts",
	"+++ b/a.ts",
	"@@ -14,3 +14,3 @@ function foo() {",
	"   a",
	"-  b",
	"+  B",
	"   c",
	"@@ -24,3 +24,3 @@ function second() {",
	"-  b",
	"+  B",
	"   c",
	"   d",
	"",
].join("\n");

function unifiedHost(): {host: HTMLElement; root: ShadowRoot} {
	const host = document.createElement("div");
	const root = host.attachShadow({mode: "open"});
	root.innerHTML = [
		"<div data-code>",
		`<div data-gutter>${separator(LABEL, 14, "context")}${separator("7 unmodified lines", 24, "change-deletion")}</div>`,
		`<div data-content>${separator(LABEL, 14, "context")}</div>`,
		"</div>",
		`<div data-code data-additions><div data-gutter>${separator(LABEL, 14, "context")}</div></div>`,
	].join("");
	return {host, root};
}

function gutterLabels(root: ShadowRoot): string[] {
	return [...root.querySelectorAll("[data-code]:not([data-additions]) > [data-gutter] [data-unmodified-lines]")].map(
		(label) => label.innerHTML,
	);
}

function untouched(root: ShadowRoot): string[] {
	return [
		...root.querySelectorAll("[data-content] [data-unmodified-lines], [data-additions] [data-unmodified-lines]"),
	].map((label) => label.innerHTML);
}

const DECORATED = [
	`<span data-unmodified-count="">${LABEL}</span><span data-hunk-heading="" title="function foo() {">function foo() {</span>`,
	'<span data-unmodified-count="">7 unmodified lines</span><span data-hunk-heading="" title="function second() {">function second() {</span>',
];

describe("decorateHunkHeadings", () => {
	it("ports upstream c91a5e4a6 g: heads the visible gutter labels only, matching the deletion side by deletionStart", () => {
		const {host, root} = unifiedHost();
		decorateHunkHeadings(host, getSingularPatch(TWO_HUNKS));
		expect({labels: gutterLabels(root), untouched: untouched(root)}).toStrictEqual({
			labels: DECORATED,
			untouched: [LABEL, LABEL],
		});
	});

	it("is idempotent across re-renders", () => {
		const {host, root} = unifiedHost();
		const fileDiff = getSingularPatch(TWO_HUNKS);
		decorateHunkHeadings(host, fileDiff);
		decorateHunkHeadings(host, fileDiff);
		expect(gutterLabels(root)).toStrictEqual(DECORATED);
	});

	it("unwraps the count and drops the heading without a fileDiff (upstream's kill switch)", () => {
		const {host, root} = unifiedHost();
		decorateHunkHeadings(host, getSingularPatch(TWO_HUNKS));
		decorateHunkHeadings(host, undefined);
		expect(gutterLabels(root)).toStrictEqual([LABEL, "7 unmodified lines"]);
	});

	it("leaves no wrapper when the heading is dropped", () => {
		const {host, root} = unifiedHost();
		decorateHunkHeadings(host, getSingularPatch(TWO_HUNKS.replaceAll("a.ts", "a.css")));
		expect(gutterLabels(root)).toStrictEqual([LABEL, "7 unmodified lines"]);
	});

	it("does nothing on a host with no shadow root", () => {
		const host = document.createElement("div");
		host.innerHTML = `<div data-code><div data-gutter>${separator(LABEL, 14, "context")}</div></div>`;
		decorateHunkHeadings(host, getSingularPatch(TWO_HUNKS));
		expect(host.querySelector("[data-unmodified-lines]")?.innerHTML).toBe(LABEL);
	});
});

describe("HUNK_HEADING_CSS", () => {
	it("is the six hunk-heading rules of upstream c91a5e4a6 sheet C, in order", () => {
		expect(HUNK_HEADING_CSS).toBe(
			[
				"[data-hunk-heading]{margin-inline-start:.5ch;font-family:var(--diffs-font-family,var(--diffs-font-fallback));line-height:0;white-space:pre;unicode-bidi:isolate}",
				'[data-hunk-heading]::before{content:" "}',
				"[data-separator-content]:has([data-unmodified-count]):hover{text-decoration:none}",
				"[data-expand-index] [data-separator-content]:hover [data-unmodified-count]{text-decoration:underline}",
				"[data-unmodified-lines]:has(>[data-hunk-heading]){max-width:calc(100cqi - 56px)}",
				'[data-diff-type="split"][data-overflow="wrap"] [data-hunk-heading]{display:none}',
			].join(""),
		);
	});

	it("is adopted once per shadow root and shared across hosts", () => {
		const a = unifiedHost();
		const b = unifiedHost();
		a.root.adoptedStyleSheets = [];
		b.root.adoptedStyleSheets = [];
		adoptHunkHeadingCss(a.host);
		adoptHunkHeadingCss(a.host);
		adoptHunkHeadingCss(b.host);
		expect({
			a: a.root.adoptedStyleSheets.length,
			b: b.root.adoptedStyleSheets.length,
			shared: a.root.adoptedStyleSheets[0] === b.root.adoptedStyleSheets[0],
		}).toStrictEqual({a: 1, b: 1, shared: true});
	});
});
