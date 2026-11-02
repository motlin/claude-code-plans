import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
function normalized(path: string): string
{
	return readFileSync(path, "utf8").replaceAll(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");
}

const markdown = normalized("src/components/markdown-article.module.css");
const globals = normalized("src/styles/globals.css");

/** Upstream's reply-type scope guard, plus local tool rows (they carry no data-cds). */
const S =
	":global([data-cds-reply-type]) .markdown:not(:global([data-cds-reply-type] :is([data-cds]:not([data-cds-reply-type]), [data-tool-row])) *)";

function missing(css: string, rules: string[]): string[]
{
	return rules.filter((rule) => !css.includes(rule));
}

describe("reply-type prose tables (cds-type-experiment-gate T5)", () =>
{
	it("drops the table frame and cell wash, pads cells like upstream and keeps message-line borders", () =>
	{
		expect(
			missing(markdown, [
				`${S} > :global(.markdown-table-wrapper), ${S} :is(li, blockquote, details) :global(.markdown-table-wrapper) { border-width: 0; border-radius: 0; }`,
				`@media (forced-colors: none) { ${S} table { border-width: 0; border-radius: 0; } }`,
				`${S} :is(th, td) { background: transparent; border-radius: 0; padding-block: calc(0.4375em + 1px); padding-inline: 0; border-color: var(--message-line, var(--color-border)); }`,
				`${S} :is(th, td) + :is(th, td) { padding-inline-start: 1.5em; }`,
				`${S} th { font-weight: var(--font-weight-header, 520); }`,
			]),
		).toStrictEqual([]);
	});

	it("keeps the message-line token in both modes", () =>
	{
		expect(missing(globals, ["--message-line: #0000001a;", "--message-line: #ffffff1a;"])).toStrictEqual([]);
	});
});

describe("reply-type inline code and weights (cds-type-experiment-gate T6)", () =>
{
	it("draws the ghost-wash primary-ink chip and upstream's 501 / 520 weights", () =>
	{
		expect(
			missing(markdown, [
				`@media screen and (forced-colors: none) { ${S} code:not(pre code) { background: var(--upstream-fill-ghost-hover); color: var(--upstream-text-primary); border: 0; border-radius: 4px; padding: 1px 4px; } }`,
				`${S} :is(strong, b) { font-weight: 501; }`,
				`${S} :is(h1, h2, h3, h4, h5, h6), ${S} :is(h1, h2, h3, h4, h5, h6, th) :is(strong, b) { font-weight: var(--font-weight-header, 520); }`,
				`${S} :is(code, kbd):not([class]) { font-weight: inherit; }`,
			]),
		).toStrictEqual([]);
	});

	it("leaves the base chip for markdown outside a reply", () =>
	{
		expect(
			missing(markdown, [
				".markdown code { font-family: var(--font-mono); font-size: 0.9em; font-weight: 400; line-height: 1; background: var(--color-alpha-1); border: none; color: var(--color-code-ink); border-radius: 0.4em; padding: 0.0625em 0.25em; }",
				".markdown strong { font-weight: 600; }",
			]),
		).toStrictEqual([]);
	});
});

describe("reply-type tool rows follow the prose size (cds-type-experiment-gate T7)", () =>
{
	it("sizes TurnStatus rows and steps inside a reply at the transcript prose size, comfortable scale in a comfortable scope", () =>
	{
		const guard = ":not([data-cds-reply-type] [data-cds]:not([data-cds-reply-type]) *)";
		expect(
			missing(globals, [
				`[data-cds-reply-type] :is([data-turn-status], [data-cds="TurnStatus"])${guard} > :first-child, [data-cds-reply-type] .group\\/step${guard} { --upstream-text-body: var(--transcript-text-size, 0.875rem); --upstream-leading-body: calc(var(--transcript-leading, 1.42857) * var(--transcript-text-size, 0.875rem)); font-size: var(--upstream-text-body); line-height: var(--upstream-leading-body);`,
				'&:where([data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] *):not(:where([data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] [data-density="comfortable"] [data-density="compact"] *)))) { --upstream-text-body: var(--transcript-comfortable-text-size, 1rem); --upstream-leading-body: var(--transcript-comfortable-leading, 1.5rem); }',
			]),
		).toStrictEqual([]);
	});
});
