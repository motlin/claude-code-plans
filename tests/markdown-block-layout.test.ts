import {describe, expect, it} from "vite-plus/test";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {markdownCss, ruleDeclarations} from "./markdown-css";
import {ruleStart} from "./css-rule";

const TABLE_MARKDOWN = "| Tool | Calls |\n| --- | --- |\n| Read | 3 |\n";

describe("markdown block layout", () =>
{
	it("collapses soft line breaks in document articles, as upstream's document mode skips remark-breaks", () =>
	{
		expect(
			{
				chat: ruleDeclarations(markdownCss, ".markdown p"),
				document: ruleDeclarations(markdownCss, ".markdown[data-document] p"),
			},
		).toStrictEqual(
			{
				chat:
				{
					margin: "4px 0",
					"white-space": "pre-wrap",
				},
				document:
				{
					"white-space": "normal",
				},
			},
		);
	});

	it("lays the article out as a column spaced by upstream's 7px prose paragraph gap", () =>
	{
		expect(ruleDeclarations(markdownCss, ".markdown")).toStrictEqual(
			{
				display: "flex",
				"flex-direction": "column",
				gap: "7px",
				"font-family": "var(--font-sans)",
				"--md-prose-size": "0.875rem",
				"--md-prose-leading": "1.25rem",
				"font-size": "var(--md-prose-size)",
				"font-weight": "400",
				"line-height": "var(--md-prose-leading)",
				color: "var(--color-primary)",
				"white-space": "normal",
			},
		);
	});

	it("indents lists 28px with 7px item padding like upstream prose", () =>
	{
		expect(
			{
				ul: ruleDeclarations(markdownCss, ".markdown ul"),
				ol: ruleDeclarations(markdownCss, ".markdown ol"),
				li: ruleDeclarations(markdownCss, ".markdown ul > li,\n.markdown ol > li"),
			},
		).toStrictEqual(
			{
				ul:
				{
					"list-style-type": "disc",
					"list-style-position": "outside",
					"padding-left": "28px",
				},
				ol:
				{
					"list-style-type": "decimal",
					"list-style-position": "outside",
					"padding-left": "28px",
				},
				li:
				{
					"margin-top": "2px",
					"margin-bottom": "2px",
					"padding-left": "7px",
				},
			},
		);
	});

	it("zeroes the block margins of every top-level block except hr", () =>
	{
		expect(ruleDeclarations(markdownCss, ".markdown > :not(hr)")).toStrictEqual(
			{
				"margin-block": "0",
			},
		);
	});

	it("declares the margin reset after the per-element rules it has to beat", () =>
	{
		const reset = ruleStart(markdownCss, ".markdown > :not(hr)");

		expect(
			{
				afterParagraph: reset > ruleStart(markdownCss, ".markdown p"),
				afterHeading: reset > ruleStart(markdownCss, ".markdown h1"),
				afterBlockquote: reset > ruleStart(markdownCss, ".markdown blockquote"),
				afterPre: reset > ruleStart(markdownCss, ".markdown pre"),
			},
		).toStrictEqual(
			{
				afterParagraph: true,
				afterHeading: true,
				afterBlockquote: true,
				afterPre: true,
			},
		);
	});

	it("wraps long code lines instead of scrolling them horizontally", () =>
	{
		const declarations = ruleDeclarations(markdownCss, ".markdown pre");

		expect(
			{
				whiteSpace: declarations["white-space"],
				overflowWrap: declarations["overflow-wrap"],
				overflowX: declarations["overflow-x"],
				width: declarations["width"],
				maxWidth: declarations["max-width"],
			},
		).toStrictEqual(
			{
				whiteSpace: "pre-wrap",
				overflowWrap: "break-word",
				overflowX: "visible",
				width: "fit-content",
				maxWidth: "100%",
			},
		);
	});

	it("scrolls wide tables inside their wrapper", () =>
	{
		expect(ruleDeclarations(markdownCss, ".markdown :global(.markdown-table-wrapper)")).toStrictEqual(
			{
				"overflow-x": "auto",
				border: "1px solid var(--color-border)",
				"border-radius": "6px",
			},
		);
	});

	it("renders tables inside a horizontally scrollable wrapper", () =>
	{
		const html = renderMarkdownToHtml(TABLE_MARKDOWN);

		expect(
			{
				opens: html.includes('<div class="markdown-table-wrapper"><table>'),
				closes: html.includes("</table>\n</div>"),
				wrappers: html.match(/markdown-table-wrapper/g)?.length ?? 0,
			},
		).toStrictEqual(
			{
				opens: true,
				closes: true,
				wrappers: 1,
			},
		);
	});

	it("leaves non-table markdown unwrapped", () =>
	{
		expect(renderMarkdownToHtml("plain paragraph").includes("markdown-table-wrapper")).toBe(false);
	});

	it("sets a blockquote upright in secondary ink, inset 7px with 14px of padding inside its 4px rule, as upstream does", () =>
	{
		expect(
			{
				blockquote: ruleDeclarations(markdownCss, ".markdown blockquote"),
				paragraph: ruleDeclarations(markdownCss, ".markdown blockquote p"),
				paragraphAfterParagraph: ruleDeclarations(markdownCss, ".markdown blockquote p + p"),
			},
		).toStrictEqual(
			{
				blockquote:
				{
					"border-left": "4px solid var(--color-border)",
					"padding-left": "14px",
					"font-style": "normal",
					color: "var(--color-secondary)",
					margin: "8px 0 8px 7px",
				},
				paragraph:
				{
					margin: "0",
				},
				paragraphAfterParagraph:
				{
					"margin-top": "10.5px",
				},
			},
		);
	});

	it("spaces transcript prose by upstream's em-based --_prose-flow margins: .75em between blocks, twice that after a list or table, none above the first", () =>
	{
		const flow =
			"p, ul, ol, dl, blockquote, pre, figure, details, :global(.markdown-codeblock), :global(.markdown-table-wrapper), :global([data-mermaid-fence])";
		const prose = ":global([data-transcript-prose]) .markdown";
		// Upstream's @scope stops at not-prose blocks, so a fence's own pre keeps its zero margin.
		const notProse = ":not(:where(:global(.markdown-codeblock), :global([data-mermaid-fence])) *)";
		// Upstream's `:first-child:not(li > :where(ul, ol, …))`: a tight list item's nested list keeps its li-child space.
		const liFlow =
			"ul, ol, dl, blockquote, pre, figure, details, :global(.markdown-codeblock), :global(.markdown-table-wrapper), :global([data-mermaid-fence])";
		// The formatter breaks these long selectors over several lines.
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect(
			{
				root: ruleDeclarations(css, prose),
				flowProperties: [
					ruleDeclarations(css, "@property --_prose-flow-base"),
					ruleDeclarations(css, "@property --_prose-flow"),
				],
				base: ruleDeclarations(css, `${prose} :is(${flow})${notProse}`),
				afterList: ruleDeclarations(css, `${prose} :is(ul, ol, dl) + :is(${flow})`),
				afterTable: ruleDeclarations(css, `${prose} :global(.markdown-table-wrapper) + :is(${flow})`),
				firstChild: ruleDeclarations(
					css,
					`${prose} > :first-child, ${prose} :is(ul, ol, blockquote, details, th, td) > :first-child, ${prose} li > :first-child:not(${liFlow})`,
				),
				oldPxRules: [css.includes("margin-top: 3.5px"), css.includes("margin-top: 14px")],
			},
		).toStrictEqual(
			{
				root:
				{
					display: "block",
					"--_prose-flow-base": "0.75em",
					"--_prose-flow": "var(--_prose-flow-base)",
					"--_prose-x-after-heading": "0.667",
					"--_prose-x-break": "2",
					"--_prose-x-after-table": "2",
					"--_prose-x-li-child": "0.333",
					"--_prose-h1-space": "3",
					"--_prose-h2-space": "2.5",
					"--_prose-h3-space": "2",
					"--_prose-h4-space": "1.667",
					"--_prose-h5-space": "1.667",
					"--_prose-h6-space": "1.667",
				},
				// Registered lengths, so the em resolves once on the article and children inherit the px value.
				flowProperties: [
					{
						syntax: '"<length>"',
						inherits: "true",
						"initial-value": "0",
					},
					{
						syntax: '"<length>"',
						inherits: "true",
						"initial-value": "0",
					},
				],
				base:
				{
					"margin-block-start": "var(--_prose-flow)",
					"margin-block-end": "0",
				},
				afterList:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-x-break))",
				},
				afterTable:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-x-after-table))",
				},
				firstChild:
				{
					"margin-block-start": "0",
				},
				oldPxRules: [false, false],
			},
		);
	});

	it("spaces transcript headings by upstream's per-level --_prose-h-space and .667 of the flow below them", () =>
	{
		const flow =
			"p, ul, ol, dl, blockquote, pre, figure, details, :global(.markdown-codeblock), :global(.markdown-table-wrapper), :global([data-mermaid-fence])";
		const headings = "h1, h2, h3, h4, h5, h6";
		const prose = ":global([data-transcript-prose]) .markdown";
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect(
			{
				levels: [1, 2, 3, 4, 5, 6].map((level) => ruleDeclarations(css, `${prose} h${level}`)),
				heading: ruleDeclarations(css, `${prose} :is(${headings})`),
				afterHeading: ruleDeclarations(css, `${prose} :is(${headings}) + :is(${flow}, ${headings})`),
				afterListOrHr: ruleDeclarations(css, `${prose} :is(ul, ol, dl, hr) + :is(${headings})`),
				afterTable: ruleDeclarations(css, `${prose} :global(.markdown-table-wrapper) + :is(${headings})`),
				afterHeadingFollowsHeading:
					css.indexOf(`${prose} :is(${headings}) + :is(`) > ruleStart(css, `${prose} :is(${headings})`),
			},
		).toStrictEqual(
			{
				levels: [1, 2, 3, 4, 5, 6].map((level) => (
				{
					"--_prose-h-space": `var(--_prose-h${level}-space)`,
				})),
				heading:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-h-space))",
					"margin-block-end": "0",
				},
				afterHeading:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-x-after-heading))",
				},
				afterListOrHr:
				{
					"margin-block-start":
						"calc(var(--_prose-flow) * max(var(--_prose-x-break), var(--_prose-h-space)))",
				},
				afterTable:
				{
					"margin-block-start":
						"calc(var(--_prose-flow) * max(var(--_prose-x-after-table), var(--_prose-h-space)))",
				},
				// Heading → heading takes the .667 space, so the after-heading rule must come later.
				afterHeadingFollowsHeading: true,
			},
		);
	});

	it("spaces transcript list items and their children by a third of the flow, with box children breaking at 1.5", () =>
	{
		const flow =
			"p, ul, ol, dl, blockquote, pre, figure, details, :global(.markdown-codeblock), :global(.markdown-table-wrapper), :global([data-mermaid-fence])";
		const prose = ":global([data-transcript-prose]) .markdown";
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect(
			{
				li: ruleDeclarations(css, `${prose} li`),
				liChild: ruleDeclarations(css, `${prose} li > :is(${flow})`),
				boxChild: ruleDeclarations(css, `${prose} :is(blockquote, details, th, td) > *`),
				oldListRules: [
					css.includes(`${prose} > ul:not(:global(.contains-task-list)) > li {`),
					css.includes(`${prose} > ul:not(:global(.contains-task-list)) > li + li {`),
				],
				// A list item's later blocks take the li-child space even after a nested list, and every first child sits flush.
				liChildAfterAfterList:
					css.indexOf(`${prose} li > :is(`) > css.indexOf(`${prose} :is(ul, ol, dl) + :is(`),
				firstChildLast: css.indexOf(`${prose} > :first-child,`) > css.indexOf(`${prose} li > :is(`),
			},
		).toStrictEqual(
			{
				li:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-x-li-child))",
					"margin-block-end": "0",
					"padding-inline-start": "0.5em",
				},
				liChild:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-x-li-child))",
				},
				boxChild:
				{
					"--_prose-x-break": "1.5",
					"--_prose-x-after-table": "1.5",
					"--_prose-h1-space": "var(--_prose-h4-space)",
					"--_prose-h2-space": "var(--_prose-h4-space)",
					"--_prose-h3-space": "var(--_prose-h4-space)",
				},
				oldListRules: [false, false],
				liChildAfterAfterList: true,
				firstChildLast: true,
			},
		);
	});

	it("rules transcript hr with a half-pixel border, twice the flow above it and after it, inset .375em", () =>
	{
		const flow =
			"p, ul, ol, dl, blockquote, pre, figure, details, :global(.markdown-codeblock), :global(.markdown-table-wrapper), :global([data-mermaid-fence])";
		const prose = ":global([data-transcript-prose]) .markdown";
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect(
			{
				hr: ruleDeclarations(css, `${prose} hr`),
				afterHr: ruleDeclarations(css, `${prose} hr + :is(${flow})`),
			},
		).toStrictEqual(
			{
				hr:
				{
					border: "0",
					"border-block-start": "0.5px solid var(--color-border)",
					"margin-block": "calc(var(--_prose-flow) * var(--_prose-x-break)) 0",
					"margin-inline": "0.375em",
				},
				afterHr:
				{
					"margin-block-start": "calc(var(--_prose-flow) * var(--_prose-x-break))",
				},
			},
		);
	});

	it("insets and stops transcript prose by the AssistantMessage text tokens, not literals", () =>
	{
		const prose = ":global([data-transcript-prose]) .markdown >";
		const css = markdownCss.replace(/\s+/g, " ").replaceAll("( ", "(").replaceAll(" )", ")");

		expect(
			{
				stop: ruleDeclarations(
					css,
					`${prose} :is(p, h1, h2, h3, h4, h5, h6, ul:not(:global(.contains-task-list)), ol, dl)`,
				),
				inset: ruleDeclarations(css, `${prose} :is(p, h1, h2, h3, h4, h5, h6)`),
				literalStop: css.includes("clamp(0px, (100% - 384px) * 0.175, 56px)"),
			},
		).toStrictEqual(
			{
				stop:
				{
					"padding-inline-end": "var(--cds-assistant-message-text-stop, 0px)",
				},
				inset:
				{
					"padding-inline-start": "var(--cds-assistant-message-text-inset, 0px)",
				},
				literalStop: false,
			},
		);
	});
});
