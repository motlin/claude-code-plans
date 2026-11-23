import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

// Whitespace-collapsed, so the formatter is free to wrap the long selector.
const css = readFileSync("src/components/markdown-article.module.css", "utf8").replace(/\s+/g, " ");

const GATE =
	':global(html[data-cds-fizzy-lake~="type"]:not([data-interface-font="dyslexic"]):not([data-reply-face="interface"])) :global([data-transcript-prose]) .markdown :is(h1, h2, h3, h4, h5, h6)';
const SELECTOR = GATE;

function ruleBody(selector: string): string | null
{
	const start = css.indexOf(` ${selector} {`);
	if (start === -1) return null;
	const open = css.indexOf("{", start + selector.length);
	return css.slice(open + 1, css.indexOf("}", open)).trim();
}

describe("serif reply heading weight reset (upstream html[data-reply-face] rule 1)", () =>
{
	it("puts transcript prose headings at semibold 580 unless the reply face is the interface font, leaving th and strong bold", () =>
	{
		expect(
			{
				heading: ruleBody(SELECTOR),
				thOrStrongRules: [...css.matchAll(/data-reply-face[^{]*\{/g)]
					.map((match) => match[0])
					.filter((selector) => /\bth\b|\bstrong\b/.test(selector)),
			},
		).toStrictEqual(
			{
				heading: "font-weight: 580;",
				thOrStrongRules: [],
			},
		);
	});

	it("comes after the base heading weights and leaves strong alone", () =>
	{
		const reset = css.indexOf(` ${SELECTOR} {`);
		expect(
			{
				afterHeadings: reset > css.indexOf(" .markdown h6 {"),
				strongRules: [...css.matchAll(/data-reply-face[^{]*\{/g)]
					.map((match) => match[0])
					.filter((selector) => /\.markdown strong\b/.test(selector)),
				strongWeight: ruleBody(".markdown strong"),
			},
		).toStrictEqual(
			{
				afterHeadings: true,
				strongRules: [],
				strongWeight: "font-weight: 600;",
			},
		);
	});
});

describe("serif Response font face (upstream tx() → Prose --_prose-font-body)", () =>
{
	it("sets transcript prose in the local serif voice only, leaving headings to inherit and code mono", () =>
	{
		const serifSelector = ':global(html[data-reply-face="serif"]) :global([data-transcript-prose]) .markdown';
		expect(
			{
				serif: ruleBody(serifSelector),
				headingFaceRules: [...css.matchAll(/data-reply-face[^{]*\{[^}]*\}/g)]
					.map((match) => match[0])
					.filter((rule) => /\bh[1-6]\b/.test(rule) && rule.includes("font-family")),
				base: (ruleBody(".markdown") ?? "").includes("font-family: var(--font-sans);"),
				pre: (ruleBody(".markdown pre") ?? "").includes("font-family: var(--font-mono);"),
				code: (ruleBody(".markdown code") ?? "").includes("font-family: var(--font-mono);"),
			},
		).toStrictEqual(
			{
				serif: "font-family: var(--font-voice);",
				headingFaceRules: [],
				base: true,
				pre: true,
				code: true,
			},
		);
	});
});
