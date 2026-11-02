// @vitest-environment jsdom

import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {MarkdownArticle} from "../src/components/markdown-article";
import {MermaidFenceGate} from "../src/components/mermaid-fence-gate";
import {mermaidLoadFailed} from "../src/lib/mermaid-gate";

const {copied, mermaidImports} = vi.hoisted(() => (
{
	copied: [] as string[],
	mermaidImports:
	{
		count: 0,
	},
}));

vi.mock("../src/lib/clipboard", () => (
{
	writeClipboardText: async (text: string) =>
	{
		copied.push(text);
		return Promise.resolve(true);
	},
}));
// Stands in for the mermaid chunk failing to load (offline, or a deploy replaced it).
vi.mock("mermaid", () =>
{
	mermaidImports.count++;
	throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() =>
{
	cleanup();
});

const MARKDOWN = "```mermaid\ngraph TD; A-->B\n```";

function shape(container: HTMLElement)
{
	return {
		fences: container.querySelectorAll("[data-testid=epitaxy-mermaid-fence]").length,
		placeholders: container.querySelectorAll("[data-testid=epitaxy-mermaid-fence-placeholder]").length,
		codeBlocks: container.querySelectorAll("[data-mermaid-fence] .markdown-codeblock").length,
	};
}

describe("MermaidFenceGate pre-gate (upstream Z)", () =>
{
	it("keeps a fence whose source holds a secret as its code block and never loads the fence or mermaid", async () =>
	{
		const code = `graph TD; A[ghp_${"x".repeat(36)}]-->B`;
		const {container} = render(
			<MermaidFenceGate code={code} codeBlockHtml={`<div class="markdown-codeblock">masked</div>`} />,
		);
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
		expect(
			{
				html: container.innerHTML,
				mermaidImports: mermaidImports.count,
				loadFailed: mermaidLoadFailed(),
			},
		).toStrictEqual(
			{
				html: `<div class="contents"><div class="markdown-codeblock">masked</div></div>`,
				mermaidImports: 0,
				loadFailed: false,
			},
		);
	});

	it("leaves a markdown fence holding a secret as the masked code block, never a diagram placeholder", () =>
	{
		const token = `ghp_${"x".repeat(36)}`;
		const {container} = render(
			<MarkdownArticle markdown={`\`\`\`mermaid\ngraph TD; A[${token}]-->B\n\`\`\``} diagrams />,
		);
		expect(
			{
				placeholders: container.querySelectorAll("[data-mermaid-fence]").length,
				codeBlocks: container.querySelectorAll(".markdown-codeblock").length,
				rawToken: container.textContent.includes(token),
			},
		).toStrictEqual(
			{
				placeholders: 0,
				codeBlocks: 1,
				rawToken: false,
			},
		);
	});
});

describe("MermaidFenceGate when mermaid cannot load (upstream gate hn / chunkFailed)", () =>
{
	it("falls back to the plain code block, and later fences never try again", async () =>
	{
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = render(<MarkdownArticle markdown={MARKDOWN} diagrams />);
		await waitFor(() =>
		{
			expect(shape(first.container)).toStrictEqual(
				{
					fences: 0,
					placeholders: 0,
					codeBlocks: 1,
				},
			);
		});

		const second = render(<MarkdownArticle markdown={MARKDOWN} diagrams />);
		expect(shape(second.container)).toStrictEqual(
			{
				fences: 0,
				placeholders: 0,
				codeBlocks: 1,
			},
		);

		fireEvent.click(second.container.querySelector("[data-copy-code]")!);
		await waitFor(() =>
		{
			expect(copied).toStrictEqual(["graph TD; A-->B\n"]);
		});
	});
});
