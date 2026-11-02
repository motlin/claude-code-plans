// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {MarkdownArticle} from "../src/components/markdown-article";

vi.mock("../src/components/mermaid-fence", () => (
{
	MermaidFence: () =>
	{
		throw new Error("fence boom");
	},
}));

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("MermaidFenceGate crash fallback (upstream EpitaxyMermaidFence boundary)", () =>
{
	it("shows the code block when the fence throws", async () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		const {container} = render(<MarkdownArticle markdown={"```mermaid\ngraph TD\n```"} diagrams />);
		await waitFor(() =>
		{
			expect(
				{
					placeholders: container.querySelectorAll("[data-testid=epitaxy-mermaid-fence-placeholder]").length,
					codeBlocks: container.querySelectorAll("[data-mermaid-fence] .markdown-codeblock").length,
				},
			).toStrictEqual(
				{
					placeholders: 0,
					codeBlocks: 1,
				},
			);
		});
	});
});
