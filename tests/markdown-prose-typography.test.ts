import {describe, expect, it} from "vite-plus/test";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {markdownCss, ruleDeclarations} from "./markdown-css";

describe("prose size at comfortable density", () => {
	it("steps transcript prose and its headings up to upstream's comfortable 16/24 (Medium) in the nearest comfortable scope", () => {
		expect({
			comfortable: ruleDeclarations(
				markdownCss,
				':global(.transcript-text)\n\t.markdown:where(:global([data-density="comfortable"] *)):not(\n\t\t:where(:global([data-density="comfortable"] [data-density="compact"] *))\n\t)',
			),
			headings: ruleDeclarations(
				markdownCss,
				".markdown h1,\n.markdown h2,\n.markdown h3,\n.markdown h4,\n.markdown h5,\n.markdown h6",
			),
		}).toStrictEqual({
			comfortable: {"--md-prose-size": "16px", "--md-prose-leading": "24px"},
			headings: {
				"font-size": "var(--md-prose-size)",
				"font-weight": "600",
				"line-height": "var(--md-prose-leading)",
			},
		});
	});
});

describe("prose strong", () => {
	it("sets bold text at upstream's 600 instead of the browser's 700", () => {
		expect(ruleDeclarations(markdownCss, ".markdown strong")).toStrictEqual({"font-weight": "600"});
	});
});

describe("prose tables", () => {
	it("frames the scroll wrapper in upstream's 6px rounded 1px border", () => {
		expect(ruleDeclarations(markdownCss, ".markdown :global(.markdown-table-wrapper)")).toStrictEqual({
			"overflow-x": "auto",
			border: "1px solid var(--color-border)",
			"border-radius": "6px",
		});
	});

	it("sets the table in the 14px/20px prose type", () => {
		expect(ruleDeclarations(markdownCss, ".markdown table")).toStrictEqual({
			"border-collapse": "collapse",
			width: "100%",
			"font-size": "var(--md-prose-size)",
			"line-height": "var(--md-prose-leading)",
		});
	});

	it("drops the per-cell grid for upstream's padding and 6rem minimum column width", () => {
		expect(ruleDeclarations(markdownCss, ".markdown :is(th, td)")).toStrictEqual({
			padding: "6.125px 10.5px",
			"min-width": "6rem",
			"text-align": "left",
		});
	});

	it("sets headers at 14px/20px weight 500 on the 5% wash over a single bottom rule", () => {
		expect(ruleDeclarations(markdownCss, ".markdown th")).toStrictEqual({
			"font-size": "var(--md-prose-size)",
			"line-height": "var(--md-prose-leading)",
			"font-weight": "500",
			background: "var(--color-alpha-1)",
			"border-bottom": "1px solid var(--color-border)",
		});
	});

	it("tops body cells so a wrapped neighbor does not center them", () => {
		expect(ruleDeclarations(markdownCss, ".markdown td")).toStrictEqual({
			"font-size": "var(--md-prose-size)",
			"vertical-align": "top",
		});
	});

	it("right-aligns numeric columns", () => {
		expect(ruleDeclarations(markdownCss, ".markdown :is(th, td)[data-numeric]")).toStrictEqual({
			"text-align": "right",
		});
	});
});

describe("numeric table columns", () => {
	it("marks every cell of a column whose body cells are all numbers", () => {
		const html = renderMarkdownToHtml(
			"| Tool | Calls | Share |\n| --- | --- | --- |\n| Read | 1,204 | 12.5% |\n| Bash | -3 | n/a |\n",
		);

		expect(html).toContain(
			[
				"<thead>",
				"<tr>",
				"<th>Tool</th>",
				'<th data-numeric="">Calls</th>',
				"<th>Share</th>",
				"</tr>",
				"</thead>",
				"<tbody>",
				"<tr>",
				"<td>Read</td>",
				'<td data-numeric="">1,204</td>',
				"<td>12.5%</td>",
				"</tr>",
				"<tr>",
				"<td>Bash</td>",
				'<td data-numeric="">-3</td>',
				"<td>n/a</td>",
				"</tr>",
				"</tbody>",
			].join("\n"),
		);
	});

	it("keeps an explicit column alignment alongside the numeric mark", () => {
		const html = renderMarkdownToHtml("| Calls |\n| :-: |\n| 3 |\n");

		expect(html).toContain('<td style="text-align:center" data-numeric="">3</td>');
	});

	it("leaves a header-only table unmarked", () => {
		expect(renderMarkdownToHtml("| 1 | 2 |\n| --- | --- |\n").includes("data-numeric")).toBe(false);
	});
});
