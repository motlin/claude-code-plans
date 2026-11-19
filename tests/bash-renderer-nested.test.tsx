// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

/** The code tile's lazily loaded pierre File, as a bare `diffs-container` holding its code. */
vi.mock("../src/components/code-tile-file", async () =>
{
	const {createElement} = await import("react");
	return {
		CodeTileFile: ({code}: {code: string}) => createElement("diffs-container", null, code),
	};
});

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => null,
}));

afterEach(cleanup);

const CALL: ClientToolCall =
{
	id: "tool-bash-1",
	name: "Bash",
	input:
	{
		command: "git status",
	},
	param: "git status",
	result: "$ git status\nnothing to commit",
	sourceUuid: "uuid-1",
};

function classNames(container: HTMLElement, selector: string): string[]
{
	return [...container.querySelectorAll(selector)].map((node) => node.className);
}

describe("BashRenderer nested body", () =>
{
	it("drops the card header and lays the body out as one flex-1 column, the Copy inside the code tile", () =>
	{
		const {container} = render(<BashRenderer toolCall={CALL} nested />);

		expect(
			{
				header: classNames(container, ".px-p6"),
				body: classNames(container, ":scope > div:first-child"),
				childCount: container.children.length,
				copyInTile: container.querySelector(".epitaxy-code-card button[aria-label='Copy']") !== null,
				copyOutsideTile: [...container.querySelectorAll("button[aria-label='Copy']")].some(
					(button) => button.closest(".epitaxy-code-card") === null,
				),
				command: container.textContent.includes("git status"),
				output: container.textContent.includes("nothing to commit"),
			},
		).toStrictEqual(
			{
				header: [],
				body: ["flex-1 min-w-0 flex flex-col gap-g6 font-mono"],
				childCount: 1,
				copyInTile: true,
				copyOutsideTile: false,
				command: true,
				output: true,
			},
		);
	});

	it("keeps the card header and padded body when not nested", () =>
	{
		const {container} = render(<BashRenderer toolCall={CALL} />);

		expect(
			{
				header: classNames(container, ".px-p6.py-p5"),
				body: classNames(container, ".gap-g6"),
				copyButton: container.querySelector("button[aria-label='Copy']") !== null,
			},
		).toStrictEqual(
			{
				header: ["flex items-center px-p6 py-p5"],
				body: ["flex flex-col gap-g6 px-p6 pb-p8 font-mono"],
				copyButton: true,
			},
		);
	});
});
