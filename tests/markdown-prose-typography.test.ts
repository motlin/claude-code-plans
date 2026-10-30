import {describe, expect, it} from "vite-plus/test";
import {appearanceCssVars} from "../src/lib/appearance";
import {renderMarkdownToHtml} from "../src/lib/client-markdown";
import {markdownCss, ruleDeclarations} from "./markdown-css";

const TRANSCRIPT_PROSE = ":global(.transcript-text) .markdown";
const COMFORTABLE_PROSE =
	':global(.transcript-text)\n\t.markdown:where(:global([data-density="comfortable"] *)):not(\n\t\t:where(:global([data-density="comfortable"] [data-density="compact"] *))\n\t)';

/** Resolves `var(--name, fallback)` against `vars`, then a `calc(a * b)` of a unitless factor and a rem length, to px. */
function resolvePx(value: string, vars: Record<string, string | null>, rootPx = 16): number {
	const substituted = value.replace(/var\((--[\w-]+), [^)]+\)/g, (_, name: string) => {
		const resolved = vars[name];
		if (resolved == null) throw new Error(`unset ${name}`);
		return resolved;
	});
	const factors = substituted.replace(/^calc\(\s*(.*?)\s*\)$/, "$1").split(" * ");
	let px = 1;
	let lengths = 0;
	for (const factor of factors) {
		if (factor.endsWith("rem")) {
			px *= Number.parseFloat(factor) * rootPx;
			lengths += 1;
		} else {
			px *= Number(factor);
		}
	}
	if (lengths !== 1 || Number.isNaN(px)) throw new Error(`not a length: ${substituted}`);
	return Math.round(px * 100) / 100;
}

describe("transcript prose follows Transcript text size", () => {
	it("derives the prose variables from the setting's custom properties, only inside the transcript", () => {
		expect({
			compact: ruleDeclarations(markdownCss, TRANSCRIPT_PROSE),
			comfortable: ruleDeclarations(markdownCss, COMFORTABLE_PROSE),
			headings: ruleDeclarations(
				markdownCss,
				".markdown h1,\n.markdown h2,\n.markdown h3,\n.markdown h4,\n.markdown h5,\n.markdown h6",
			),
		}).toStrictEqual({
			compact: {
				"--md-prose-size": "var(--transcript-text-size, 0.875rem)",
				"--md-prose-leading":
					"calc(var(--transcript-leading, 1.42857) * var(--transcript-text-size, 0.875rem))",
			},
			comfortable: {
				"--md-prose-size": "var(--transcript-comfortable-text-size, 1rem)",
				"--md-prose-leading":
					"calc( var(--transcript-comfortable-leading, 1.5) * var(--transcript-comfortable-text-size, 1rem) )",
			},
			headings: {
				"font-size": "var(--md-prose-size)",
				"font-weight": "600",
				"line-height": "var(--md-prose-leading)",
			},
		});
	});

	it("sizes prose at upstream's chat body for each setting, and its comfortable steps on touch", () => {
		const compact = ruleDeclarations(markdownCss, TRANSCRIPT_PROSE);
		const comfortable = ruleDeclarations(markdownCss, COMFORTABLE_PROSE);
		const measured = Object.fromEntries(
			(["sm", "md", "lg"] as const).map((transcriptTextSize) => {
				const vars = appearanceCssVars({interfaceFont: "sans", transcriptTextSize, transcriptWidth: "narrow"});
				return [
					transcriptTextSize,
					{
						compact: [
							resolvePx(compact["--md-prose-size"]!, vars),
							resolvePx(compact["--md-prose-leading"]!, vars),
						],
						comfortable: [
							resolvePx(comfortable["--md-prose-size"]!, vars),
							resolvePx(comfortable["--md-prose-leading"]!, vars),
						],
					},
				];
			}),
		);

		expect(measured).toStrictEqual({
			sm: {compact: [13, 18.57], comfortable: [15, 22]},
			md: {compact: [14, 20], comfortable: [16, 24]},
			lg: {compact: [15, 22], comfortable: [18, 27]},
		});
	});

	it("keeps plan pages and other markdown at the fixed 14/20 prose size", () => {
		expect(ruleDeclarations(markdownCss, ".markdown")).toMatchObject({
			"--md-prose-size": "0.875rem",
			"--md-prose-leading": "1.25rem",
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
