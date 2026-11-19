// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {MarkdownArticle} from "../src/components/markdown-article";

// The island's content is covered in mermaid-fence-gate.test.tsx; here it shows what it was handed.
vi.mock("../src/components/mermaid-fence-gate", () => (
{
	MermaidFenceGate: ({code, codeBlockHtml}: {code: string; codeBlockHtml: string}) => (
		<span data-testid="island" data-has-code-block={String(codeBlockHtml.includes("markdown-codeblock"))}>
			{code}
		</span>
	),
}));

afterEach(() =>
{
	cleanup();
});

const fence = (source: string) => `Before\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nAfter`;

function islands(root: ParentNode)
{
	return [...root.querySelectorAll<HTMLElement>("[data-testid=island]")].map((island) => (
	{
		fence: island.parentElement?.getAttribute("data-mermaid-fence"),
		code: island.textContent,
		codeBlock: island.dataset["hasCodeBlock"],
		siblings: island.parentElement?.childElementCount,
	}));
}

describe("mermaid islands in MarkdownArticle", () =>
{
	it("mounts the fence into its placeholder, taking over the code block", () =>
	{
		const {container} = render(<MarkdownArticle markdown={fence("graph TD; A-->B")} diagrams />);
		expect(islands(container)).toStrictEqual([
			{
				fence: "0",
				code: "graph TD; A-->B",
				codeBlock: "true",
				siblings: 1,
			},
		]);
	});

	it("remounts with the new source when the markdown changes, leaving no stale island", () =>
	{
		const view = render(<MarkdownArticle markdown={fence("graph TD; A-->B")} diagrams />);
		view.rerender(<MarkdownArticle markdown={fence("pie")} diagrams />);
		expect(islands(view.container)).toStrictEqual([
			{
				fence: "0",
				code: "pie",
				codeBlock: "true",
				siblings: 1,
			},
		]);
	});

	it("leaves nothing behind on unmount", () =>
	{
		const view = render(<MarkdownArticle markdown={fence("graph TD; A-->B")} diagrams />);
		view.unmount();
		expect(islands(document.body)).toStrictEqual([]);
	});

	it("mounts nothing outside the diagram context", () =>
	{
		const {container} = render(<MarkdownArticle markdown={fence("graph TD; A-->B")} />);
		expect(
			{
				islands: islands(container),
				codeBlocks: container.querySelectorAll(".markdown-codeblock").length,
			},
		).toStrictEqual(
			{
				islands: [],
				codeBlocks: 1,
			},
		);
	});

	it("lets a document figure bleed past the column with upstream c3fde7009's rules, on the panel surface", () =>
	{
		const styles = readFileSync("src/styles/globals.css", "utf8")
			.replaceAll(/\s+/g, " ")
			.replaceAll("( ", "(")
			.replaceAll(" )", ")");
		const rules = [
			".epitaxy-document-prose [data-document-figure] { --document-figure: calc(var(--figure-width) + 2rem + 1px); --document-figure-start: var(--document-bleed-start, var(--document-bleed)); box-sizing: border-box; width: min(var(--document-figure), 100% + var(--document-figure-start) + var(--document-bleed)); min-width: 100%; margin-inline-start: calc(-1 * max(0px, min(var(--document-figure-start), var(--document-figure) - 100% - var(--document-bleed)))); }",
			".epitaxy-document-prose [data-document-figure] [data-mermaid] { background-color: var(--color-surface-2); }",
			".epitaxy-document-prose :is(li, blockquote, dd) [data-document-figure] { width: auto; margin-inline-start: 0; }",
			".epitaxy-document-prose { --document-bleed: 0px; --document-bleed-start: var(--document-bleed); }",
		];
		expect(rules.filter((rule) => !styles.includes(rule))).toStrictEqual([]);
	});
});
