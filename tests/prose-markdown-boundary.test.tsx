// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {Component, type ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ProseMarkdown} from "../src/components/file-refs";

vi.mock("../src/lib/client-markdown", async (importOriginal) =>
{
	const actual = await importOriginal<typeof import("../src/lib/client-markdown")>();
	return {
		...actual,
		renderMarkdownWithHighlighting: (markdown: string, ...rest: unknown[]) =>
		{
			if (markdown.includes("**hi**")) throw new Error("markdown boom");
			return (actual.renderMarkdownWithHighlighting as (...args: unknown[]) => string)(markdown, ...rest);
		},
	};
});

class Outer extends Component<
	{
		children: ReactNode;
	},
	{
		caught: boolean;
	}
>
{
	override state =
	{
		caught: false,
	};
	static getDerivedStateFromError()
	{
		return {
			caught: true,
		};
	}
	override render(): ReactNode
	{
		return this.state.caught ? <p>outer caught</p> : this.props.children;
	}
}

beforeEach(() =>
{
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("ProseMarkdown crash fallback", () =>
{
	it("draws the raw text as plain text inside the prose wrapper when markdown rendering throws", () =>
	{
		const {container} = render(
			<Outer>
				<ProseMarkdown markdown={"**hi** there\nnext line"} />
			</Outer>,
		);
		const article = container.querySelector("article");
		expect(article?.parentElement).toEqual(container);
		expect(article?.innerHTML).toEqual('<div class="whitespace-pre-wrap">**hi** there\nnext line</div>');
		expect(container.textContent).not.toContain("outer caught");
	});

	it("renders markdown as before when nothing throws", () =>
	{
		const {container} = render(<ProseMarkdown markdown="plain **bold**" />);
		expect(container.querySelector("article strong")?.textContent).toEqual("bold");
	});
});
