// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
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
				copyInTile: container.querySelector(".epitaxy-code-card button[aria-label='Copy command']") !== null,
				copyOutsideTile: [...container.querySelectorAll("button[aria-label^='Copy']")]
					.filter((button) => button.closest(".epitaxy-code-card") === null)
					.map((button) => button.getAttribute("aria-label")),
				command: container.textContent.includes("git status"),
				output: container.textContent.includes("nothing to commit"),
			},
		).toStrictEqual(
			{
				header: [],
				body: ["flex-1 min-w-0 flex flex-col justify-center epitaxy-code-size gap-md text-code"],
				childCount: 1,
				copyInTile: true,
				copyOutsideTile: ["Copy output"],
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
				body: classNames(container, ".pb-lg"),
				copyButton: container.querySelector("button[aria-label='Copy command']") !== null,
			},
		).toStrictEqual(
			{
				header: ["flex items-center px-p6 py-p5"],
				body: ["flex flex-col px-md pb-lg epitaxy-code-size gap-md text-code"],
				copyButton: true,
			},
		);
	});

	it("puts the output beside a hover Copy output column under the tile, copying the ANSI-stripped output", async () =>
	{
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				value:
				{
					writeText,
				},
				configurable: true,
			},
		);
		const shape = async (nested: boolean) =>
		{
			const {container} = render(
				<BashRenderer
					toolCall={
					{
						...CALL,
						result: "$ git status\n\u001b[31mred\u001b[0m",
					}}
					nested={nested}
				/>,
			);
			const tile = container.querySelector(".epitaxy-code-card")!;
			const row = tile.nextElementSibling!;
			const output = container.querySelector("[data-bash-output]")!;
			fireEvent.click(container.querySelector<HTMLElement>("button[aria-label='Copy output']")!);
			await act(async () =>
			{
				await Promise.resolve();
			});
			const result =
			{
				row: row.className,
				columns: [...row.children].map((child) => child.className),
				outputInRow: row.firstElementChild?.firstElementChild === output,
				region: [
					output.getAttribute("role"),
					output.getAttribute("aria-label"),
					output.getAttribute("tabindex"),
					output.className.includes("max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words"),
				],
			};
			cleanup();
			return result;
		};
		const expected =
		{
			row: "flex min-w-0 items-start gap-xs",
			columns: ["flex min-w-0 flex-1 flex-col gap-md", "flex h-[1lh] shrink-0 items-center pe-md"],
			outputInRow: true,
			region: ["group", "Tool output", "0", true],
		};
		expect([await shape(true), await shape(false), writeText.mock.calls]).toStrictEqual([
			expected,
			expected,
			[["red"], ["red"]],
		]);
	});

	it("keeps an output-only call's Copy beside the body with no Copy output column", () =>
	{
		const {container} = render(
			<BashRenderer
				toolCall={
				{
					...CALL,
					input: {},
				}}
				nested
			/>,
		);
		expect(
			[...container.querySelectorAll("button[aria-label^='Copy']")].map((button) =>
				button.getAttribute("aria-label"),
			),
		).toStrictEqual(["Copy"]);
	});
});
