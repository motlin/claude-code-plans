// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import {collectFindRanges, foldFindText} from "../src/lib/find-in-page/match";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {EYE_ICON_SVG} from "../src/lib/icon-paths";

/** A fake GitHub-token-shaped value, built at runtime so no secret-shaped literal lands in the repo. */
const FAKE_GH = `ghp_${"A".repeat(36)}`;
const MASKED_GH = `ghp_AAAA${"•".repeat(32)}`;

/** Upstream cloak `v` (cb557955f), masked or revealed, with a cds Icon standing in for the Eye. */
function cloakHtml(masked: boolean): string {
	const value = masked
		? `<span data-find-omitted="" class="sr-only select-none">Redacted GitHub token</span><span aria-hidden="true">${MASKED_GH}</span>`
		: FAKE_GH;
	return `<span data-redacted-secret="" class="inline-flex max-w-full items-baseline gap-[2px] align-baseline"><span class="break-all">${value}</span><button type="button" aria-pressed="${String(!masked)}" aria-label="${masked ? "Reveal" : "Hide"} GitHub token"><span data-cds="Icon">${EYE_ICON_SVG}</span></button></span>`;
}

function mount(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.replaceChildren(root);
	return root;
}

function find(html: string, query: string): string[] {
	return collectFindRanges(mount(html), query).map((range) => range.toString());
}

describe("foldFindText", () => {
	it("strips diacritics and lowercases", () => {
		expect(foldFindText("Café ŁÓDŹ")).toBe("cafe lodz");
	});
});

describe("collectFindRanges walker", () => {
	it("never spans block elements or newlines, skips data-find-omitted, keeps data-find-included", () => {
		expect({
			blocks: find("<p>ab</p><p>c</p>", "bc"),
			newline: find("<pre>a\nb</pre>", "ab"),
			omitted: find("<div data-find-omitted>x</div>", "x"),
			included: find("<div data-find-omitted><span data-find-included>x</span></div>", "x"),
			folded: find("<p>Café SESSION</p>", "cafe session"),
		}).toStrictEqual({
			blocks: [],
			newline: [],
			omitted: [],
			included: ["x"],
			folded: ["Café SESSION"],
		});
	});

	it("skips a cds Icon element without a boundary", () => {
		const html = '<p>a<span data-cds="Icon">ICON</span>b</p>';
		// "ab" matches across the skipped icon, so the one range runs from "a" to "b" and spans the icon node.
		expect({ab: find(html, "ab"), icon: find(html, "ICON")}).toStrictEqual({ab: ["aICONb"], icon: []});
	});

	it("skips the masked cloak's label behind a boundary but finds the aria-hidden masked value", () => {
		const html = `<p>export GH=${cloakHtml(true)} done</p>`;
		expect({
			redacted: find(html, "Redacted"),
			token: find(html, "token"),
			prefix: find(html, "ghp_AAAA"),
			acrossLabel: find(html, "GH=ghp"),
			acrossButton: find(html, "•• done"),
		}).toStrictEqual({
			redacted: [],
			token: [],
			prefix: ["ghp_AAAA"],
			acrossLabel: [],
			acrossButton: ["•• done"],
		});
	});

	it("finds a revealed cloak's raw value together with the text before it", () => {
		const html = `<p>export GH=${cloakHtml(false)} done</p>`;
		expect({raw: find(html, "GH=ghp_AAAA"), redacted: find(html, "Redacted")}).toStrictEqual({
			raw: ["GH=ghp_AAAA"],
			redacted: [],
		});
	});

	it("applies the same rules to the rendered inline-code cloak", () => {
		const html = renderMarkdownToHtml(`export \`${FAKE_GH}\` done`);
		expect({
			redacted: find(html, "Redacted"),
			prefix: find(html, "ghp_AAAA"),
			rawTail: find(html, "A".repeat(20)),
		}).toStrictEqual({redacted: [], prefix: ["ghp_AAAA"], rawTail: []});
	});

	it("returns nothing for an empty query", () => {
		expect(find("<p>abc</p>", "")).toStrictEqual([]);
	});
});
