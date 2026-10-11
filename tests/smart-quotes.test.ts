import {describe, expect, it} from "vite-plus/test";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {newQuoteState, smartenQuotes} from "../src/lib/smart-quotes";

function smarten(text: string): string {
	return smartenQuotes(text, newQuoteState());
}

describe("smartenQuotes", () => {
	it("curls apostrophes, double quotes and nested single quotes as upstream does", () => {
		expect({
			apostrophe: smarten("I couldn't find an actual link"),
			doubles: smarten('Your "kinds of upgrades" draft'),
			nested: smarten(`He said "the 'outline' doc" was done.`),
			leading: smarten("'Twas the night; rock 'n' roll in the '90s"),
			possessive: smarten("Pete's and the teams' docs"),
		}).toStrictEqual({
			apostrophe: "I couldn’t find an actual link",
			doubles: "Your “kinds of upgrades” draft",
			nested: "He said “the ‘outline’ doc” was done.",
			leading: "’Twas the night; rock ’n’ roll in the ’90s",
			possessive: "Pete’s and the teams’ docs",
		});
	});

	it("leaves feet-and-inches and attribute quotes straight", () => {
		expect({
			measure: smarten(`He is 5'10" tall`),
			attribute: smarten(`<div class="x">`),
		}).toStrictEqual({
			measure: `He is 5'10" tall`,
			attribute: `<div class="x">`,
		});
	});
});

describe("smart quotes in rendered markdown", () => {
	const source = [
		"It's \"done\" and [Pete's doc](https://example.com/it's) is `it's` here.",
		"",
		"```",
		'const s = "it\'s";',
		"```",
	].join("\n");

	it("curls prose text only, never inline code, code blocks or hrefs", () => {
		const fence = renderMarkdownToHtml(source.split("\n").slice(2).join("\n"));
		expect(renderMarkdownToHtml(source, {smartQuotes: true})).toBe(
			'<p>It\u2019s \u201cdone\u201d and <a href="https://example.com/it\'s" target="_blank" rel="noreferrer">Pete\u2019s doc</a> is <code>it\'s</code> here.</p>\n' +
				fence,
		);
	});

	it("keeps ASCII quotes when smart quotes are off", () => {
		expect(renderMarkdownToHtml('It\'s "done"')).toBe("<p>It's &quot;done&quot;</p>\n");
	});

	it("leaves a bare linkified URL as written", () => {
		expect(renderMarkdownToHtml("See https://example.com/it's now", {smartQuotes: true})).toBe(
			'<p>See <a href="https://example.com/it\'s" target="_blank" rel="noreferrer">https://example.com/it\'s</a> now</p>\n',
		);
	});
});
