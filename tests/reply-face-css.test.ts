import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

// Whitespace-collapsed, so the formatter is free to wrap the long selector.
const css = readFileSync("src/components/markdown-article.module.css", "utf8").replace(/\s+/g, " ");

const GATE =
	':global(html[data-cds-fizzy-lake~="type"]:not([data-interface-font="dyslexic"]):not([data-reply-face="interface"])) :global([data-transcript-prose]) .markdown :is(h1, h2, h3, h4, h5, h6, th)';
const SELECTOR = `${GATE}, ${GATE} strong`;

function ruleBody(selector: string): string | null {
	const start = css.indexOf(` ${selector} {`);
	if (start === -1) return null;
	const open = css.indexOf("{", start + selector.length);
	return css.slice(open + 1, css.indexOf("}", open)).trim();
}

describe("serif reply heading weight reset (upstream html[data-reply-face] rule 1)", () => {
	it("puts transcript prose headings and th at semibold 580 unless the reply face is the interface font", () => {
		expect(ruleBody(SELECTOR)).toBe("font-weight: 580;");
	});

	it("comes after the base heading and th weights and leaves strong alone", () => {
		const reset = css.indexOf(` ${SELECTOR} {`);
		expect({
			afterHeadings: reset > css.indexOf(" .markdown h6 {"),
			afterTh: reset > css.indexOf(" .markdown th {"),
			strongRules: [...css.matchAll(/data-reply-face[^{]*\{/g)]
				.map((match) => match[0])
				.filter((selector) => /\.markdown strong\b/.test(selector)),
			strongWeight: ruleBody(".markdown strong"),
		}).toStrictEqual({afterHeadings: true, afterTh: true, strongRules: [], strongWeight: "font-weight: 600;"});
	});
});
