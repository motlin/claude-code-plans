// @vitest-environment jsdom

import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {MarkdownArticle} from "../src/components/markdown-article";

const {copied} = vi.hoisted(() => ({copied: [] as string[]}));

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: async (text: string) => {
		copied.push(text);
		return Promise.resolve(true);
	},
}));
// Stands in for the mermaid chunk failing to load (offline, or a deploy replaced it).
vi.mock("mermaid", () => {
	throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
	cleanup();
});

const MARKDOWN = "```mermaid\ngraph TD; A-->B\n```";

function shape(container: HTMLElement) {
	return {
		fences: container.querySelectorAll("[data-testid=epitaxy-mermaid-fence]").length,
		placeholders: container.querySelectorAll("[data-testid=epitaxy-mermaid-fence-placeholder]").length,
		codeBlocks: container.querySelectorAll("[data-mermaid-fence] .markdown-codeblock").length,
	};
}

describe("MermaidFenceGate when mermaid cannot load (upstream gate hn / chunkFailed)", () => {
	it("falls back to the plain code block, and later fences never try again", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = render(<MarkdownArticle markdown={MARKDOWN} diagrams />);
		await waitFor(() => {
			expect(shape(first.container)).toStrictEqual({fences: 0, placeholders: 0, codeBlocks: 1});
		});

		const second = render(<MarkdownArticle markdown={MARKDOWN} diagrams />);
		expect(shape(second.container)).toStrictEqual({fences: 0, placeholders: 0, codeBlocks: 1});

		fireEvent.click(second.container.querySelector("[data-copy-code]")!);
		await waitFor(() => {
			expect(copied).toStrictEqual(["graph TD; A-->B\n"]);
		});
	});
});
