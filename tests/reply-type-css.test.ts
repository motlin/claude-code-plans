import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

/* Whitespace-normalised, with no padding inside parentheses, so formatter line breaks don't matter. */
function normalized(path: string): string
{
	return readFileSync(path, "utf8").replaceAll(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");
}

const markdown = normalized("src/components/markdown-article.module.css");
const globals = normalized("src/styles/globals.css");

/** Upstream's flat-tables Prose scope, guarded from prose nested in another cds component or a local tool row. */
const S =
	'.markdown[data-prose-tables="flat"]:not(:global([data-prose-tables="flat"] :is([data-cds], [data-tool-row])) *)';

function missing(css: string, rules: string[]): string[]
{
	return rules.filter((rule) => !css.includes(rule));
}

describe("flat reply prose tables (cds-type-experiment-gate T5)", () =>
{
	it("drops the table frame and cell wash, pads cells like upstream and keeps message-line borders", () =>
	{
		expect(
			missing(markdown, [
				`${S} > :global(.markdown-table-wrapper), ${S} :is(li, blockquote, details) :global(.markdown-table-wrapper) { border-width: 0; border-radius: 0; }`,
				`@media (forced-colors: none) { ${S} table { border-width: 0; border-radius: 0; } }`,
				`${S} :is(th, td) { background: transparent; border-radius: 0; padding-block: calc(0.4375em + 1px); padding-inline: 0; border-color: var(--message-line, var(--color-border)); }`,
				`${S} :is(th, td) + :is(th, td) { padding-inline-start: 1.5em; }`,
			]),
		).toStrictEqual([]);
	});

	it("leaves no data-cds-reply-type selector behind (upstream retired it)", () =>
	{
		expect([markdown.includes("data-cds-reply-type"), globals.includes("data-cds-reply-type")]).toStrictEqual([
			false,
			false,
		]);
	});

	it("keeps the message-line token in both modes", () =>
	{
		expect(missing(globals, ["--message-line: #0000001a;", "--message-line: #ffffff1a;"])).toStrictEqual([]);
	});
});

describe("flat reply prose inline code and weights (cds-type-experiment-gate T6)", () =>
{
	it("draws the ghost-wash primary-ink chip, semibold headings and bold strong / th held on the semibold axis", () =>
	{
		expect(
			missing(markdown, [
				`@media screen and (forced-colors: none) { ${S} code:not(pre code) { background: var(--upstream-fill-ghost-hover); color: var(--upstream-text-primary); border: 0; border-radius: 4px; padding: 1px 4px; } }`,
				`${S} :is(h1, h2, h3, h4, h5, h6) { font-weight: 580; }`,
				`${S} :is(th, strong, b) { font-weight: 600; --cds-font-axis-wght: "wght" 580, var(--cds-font-axis-wght-semibold,); font-variation-settings: var(--font-opsz-axis,) var(--cds-font-axis-wght,) "GRAD" var(--cds-font-grad, 0); }`,
				`${S} :is(code, kbd):not([class]) { font-weight: inherit; }`,
			]),
		).toStrictEqual([]);
		expect([...markdown.matchAll(/font-weight: (?:501|var\(--font-weight-header, 520\));/g)]).toStrictEqual([]);
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

describe("transcript text size spares controls (permission-card-variants live check, 2026-11-21)", () =>
{
	it("keeps text-body buttons, inputs, textareas, toolbar text and cds-reset links at the density size", () =>
	{
		expect(
			missing(globals, [
				'.transcript-text :is(.text-body, .text-body-medium, .text-body-semibold):is(button, input, textarea, [role~="toolbar"] *, a.cds-reset) { font-size: var(--density-text-body); line-height: var(--tw-leading, var(--density-leading-body)); }',
			]),
		).toStrictEqual([]);
	});
});
