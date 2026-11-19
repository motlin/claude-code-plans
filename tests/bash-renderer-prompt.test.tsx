// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {HighlightedCommand} from "../src/components/tool-renderers/bash-renderer";

const NBSP = String.fromCharCode(160);

const highlighted = vi.hoisted(() => (
{
	tokens: null as unknown,
}));

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => highlighted.tokens,
}));

afterEach(() =>
{
	highlighted.tokens = null;
	cleanup();
});

function promptLayout(container: HTMLElement)
{
	const row = container.querySelector(".flex > span.select-none")?.parentElement;
	return {
		rowClass: row?.className,
		promptClass: row?.children[0]?.className,
		promptText: row?.children[0]?.textContent,
		commandClass: row?.children[1]?.className,
		commandText: row?.children[1]?.textContent,
	};
}

describe("HighlightedCommand prompt", () =>
{
	it("renders the highlighted prompt as an unselectable gutter beside the command column", () =>
	{
		highlighted.tokens = [
			[
				{
					content: "git ",
					color: "#aaa",
					offset: 0,
				},
				{
					content: "status",
					color: "#bbb",
					offset: 4,
				},
			],
		];

		const {container} = render(<HighlightedCommand command="git status" />);

		expect(promptLayout(container)).toStrictEqual(
			{
				rowClass: "flex",
				promptClass: "select-none text-secondary",
				promptText: `$${NBSP}`,
				commandClass: "min-w-0 flex-1 whitespace-pre-wrap",
				commandText: "git status",
			},
		);
	});

	it("hides the prompt glyph from screen readers and in-app Find, with upstream's > for powershell", () =>
	{
		const prompt = (language?: string) =>
		{
			const {container} = render(
				language === undefined ? (
					<HighlightedCommand command="ls" />
				) : (
					<HighlightedCommand command="ls" language={language} />
				),
			);
			const html = container.querySelector(".flex > span.select-none")?.outerHTML;
			cleanup();
			return html;
		};

		expect([prompt(), prompt("powershell")]).toStrictEqual([
			'<span aria-hidden="true" data-find-omitted="" class="select-none text-secondary">$&nbsp;</span>',
			'<span aria-hidden="true" data-find-omitted="" class="select-none text-secondary">&gt;&nbsp;</span>',
		]);
	});
});
