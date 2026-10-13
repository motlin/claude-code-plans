// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {MarkdownArticle} from "../src/components/markdown-article";

afterEach(cleanup);

describe("MarkdownArticle zoned times", () => {
	it("draws a zoned time plain on first paint, then re-renders it as upstream's time-with-zone span once the parser loads", async () => {
		const {container} = render(<MarkdownArticle markdown="auto-merged at 19:24 UTC." zonedTimes />);
		const firstPaint = container.querySelectorAll("[data-testid='time-with-zone']").length;

		await waitFor(() => {
			expect(container.querySelector("[data-testid='time-with-zone']")?.textContent).toBe("19:24 UTC");
		});
		expect(firstPaint).toBe(0);
	});
});
