import {describe, expect, it} from "vite-plus/test";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {markdownCss, ruleDeclarations} from "./markdown-css";

const TABLE_MARKDOWN = "| Tool | Calls |\n| --- | --- |\n| Read | 3 |\n";

describe("markdown block layout", () => {
	it("collapses soft line breaks in document articles, as upstream's document mode skips remark-breaks", () => {
		expect({
			chat: ruleDeclarations(markdownCss, ".markdown p"),
			document: ruleDeclarations(markdownCss, ".markdown[data-document] p"),
		}).toStrictEqual({
			chat: {margin: "4px 0", "white-space": "pre-wrap"},
			document: {"white-space": "normal"},
		});
	});

	it("lays the article out as a column spaced by upstream's 7px prose paragraph gap", () => {
		expect(ruleDeclarations(markdownCss, ".markdown")).toStrictEqual({
			display: "flex",
			"flex-direction": "column",
			gap: "7px",
			"font-family": "var(--font-sans)",
			"font-size": "14px",
			"font-weight": "400",
			"line-height": "20px",
			color: "var(--color-primary)",
			"white-space": "normal",
		});
	});

	it("indents lists 28px with 7px item padding like upstream prose", () => {
		expect({
			ul: ruleDeclarations(markdownCss, ".markdown ul"),
			ol: ruleDeclarations(markdownCss, ".markdown ol"),
			li: ruleDeclarations(markdownCss, ".markdown ul > li,\n.markdown ol > li"),
		}).toStrictEqual({
			ul: {
				"list-style-type": "disc",
				"list-style-position": "outside",
				"padding-left": "28px",
			},
			ol: {
				"list-style-type": "decimal",
				"list-style-position": "outside",
				"padding-left": "28px",
			},
			li: {
				"margin-top": "2px",
				"margin-bottom": "2px",
				"padding-left": "7px",
			},
		});
	});

	it("zeroes the block margins of every top-level block except hr", () => {
		expect(ruleDeclarations(markdownCss, ".markdown > :not(hr)")).toStrictEqual({
			"margin-block": "0",
		});
	});

	it("declares the margin reset after the per-element rules it has to beat", () => {
		const reset = markdownCss.indexOf(".markdown > :not(hr) {");

		expect({
			afterParagraph: reset > markdownCss.indexOf(".markdown p {"),
			afterHeading: reset > markdownCss.indexOf(".markdown h1 {"),
			afterBlockquote: reset > markdownCss.indexOf(".markdown blockquote {"),
			afterPre: reset > markdownCss.indexOf(".markdown pre {"),
		}).toStrictEqual({
			afterParagraph: true,
			afterHeading: true,
			afterBlockquote: true,
			afterPre: true,
		});
	});

	it("wraps long code lines instead of scrolling them horizontally", () => {
		const declarations = ruleDeclarations(markdownCss, ".markdown pre");

		expect({
			whiteSpace: declarations["white-space"],
			overflowWrap: declarations["overflow-wrap"],
			overflowX: declarations["overflow-x"],
			width: declarations["width"],
			maxWidth: declarations["max-width"],
		}).toStrictEqual({
			whiteSpace: "pre-wrap",
			overflowWrap: "break-word",
			overflowX: "visible",
			width: "fit-content",
			maxWidth: "100%",
		});
	});

	it("scrolls wide tables inside their wrapper", () => {
		expect(ruleDeclarations(markdownCss, ".markdown :global(.markdown-table-wrapper)")).toStrictEqual({
			"overflow-x": "auto",
			border: "1px solid var(--color-border)",
			"border-radius": "6px",
		});
	});

	it("renders tables inside a horizontally scrollable wrapper", () => {
		const html = renderMarkdownToHtml(TABLE_MARKDOWN);

		expect({
			opens: html.includes('<div class="markdown-table-wrapper"><table>'),
			closes: html.includes("</table>\n</div>"),
			wrappers: html.match(/markdown-table-wrapper/g)?.length ?? 0,
		}).toStrictEqual({opens: true, closes: true, wrappers: 1});
	});

	it("leaves non-table markdown unwrapped", () => {
		expect(renderMarkdownToHtml("plain paragraph").includes("markdown-table-wrapper")).toBe(false);
	});

	it("sets a blockquote upright in secondary ink, inset 7px with 14px of padding inside its 4px rule, as upstream does", () => {
		expect({
			blockquote: ruleDeclarations(markdownCss, ".markdown blockquote"),
			paragraph: ruleDeclarations(markdownCss, ".markdown blockquote p"),
			paragraphAfterParagraph: ruleDeclarations(markdownCss, ".markdown blockquote p + p"),
		}).toStrictEqual({
			blockquote: {
				"border-left": "4px solid var(--color-border)",
				"padding-left": "14px",
				"font-style": "normal",
				color: "var(--color-secondary)",
				margin: "8px 0 8px 7px",
			},
			paragraph: {margin: "0"},
			paragraphAfterParagraph: {"margin-top": "10.5px"},
		});
	});

	it("spaces transcript prose by upstream's 10.5px flow: 21px after a list or table, 7px after a heading", () => {
		const flow =
			"p, ul:not(:global(.contains-task-list)), ol, dl, blockquote, pre, figure, details, :global(.markdown-codeblock), :global(.markdown-table-wrapper)";
		const prose = ":global([data-transcript-prose]) .markdown >";
		// The formatter breaks these long selectors over several lines.
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect({
			base: ruleDeclarations(css, `${prose} * + :is(${flow})`),
			afterListOrTable: ruleDeclarations(
				css,
				`${prose} :is(ul:not(:global(.contains-task-list)), ol, dl, :global(.markdown-table-wrapper)) + :is(${flow})`,
			),
			afterHeading: ruleDeclarations(css, `${prose} :is(h1, h2, h3, h4, h5, h6) + :is(${flow})`),
			oldPairRules: [
				css.includes(`${prose} p + p`),
				css.includes(`${prose} * + blockquote`),
				css.includes(`${prose} ul:not(:global(.contains-task-list)) + p`),
			],
		}).toStrictEqual({
			base: {"margin-top": "3.5px"},
			afterListOrTable: {"margin-top": "14px"},
			afterHeading: {"margin-top": "0"},
			oldPairRules: [false, false, false],
		});
	});

	it("ends transcript prose blocks short of the column by upstream's stop: 17.5% of the width past 384px, at most 56px", () => {
		const prose = ":global([data-transcript-prose]) .markdown >";
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect({
			stop: ruleDeclarations(
				css,
				`${prose} :is(p, h1, h2, h3, h4, h5, h6, ul:not(:global(.contains-task-list)), ol, dl)`,
			),
			inset: ruleDeclarations(css, `${prose} :is(p, h1, h2, h3, h4, h5, h6)`),
			fixedStop: css.includes("56px;") && !css.includes("clamp(0px, (100% - 384px) * 0.175, 56px)"),
		}).toStrictEqual({
			stop: {"padding-inline-end": "clamp(0px, (100% - 384px) * 0.175, 56px)"},
			inset: {"padding-inline-start": "4px"},
			fixedStop: false,
		});
	});
});
