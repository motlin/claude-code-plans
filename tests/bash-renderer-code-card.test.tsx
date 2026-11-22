// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {createElement} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => null,
}));

/** The tile's pierre `File`, drawn as a bare `diffs-container` holding the code it was given. */
vi.mock("@pierre/diffs/react", async (importOriginal) => (
{
	...(await importOriginal<typeof import("@pierre/diffs/react")>()),
	File: ({
		file,
	}: {
		file:
		{
			contents: string;
		};
	}) => createElement("diffs-container", null, file.contents),
}));

afterEach(cleanup);

const CARD = "epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code";

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

function layout(container: HTMLElement)
{
	const card = container.querySelector(".epitaxy-code-card");
	const output = container.querySelector("[data-bash-output]");
	return {
		body: card?.parentElement?.className,
		card: card?.className,
		cardText: card?.textContent,
		action: card?.lastElementChild?.className,
		copyInAction: card?.lastElementChild?.querySelector("button[aria-label='Copy command']") !== null,
		output: output?.className,
		outputText: output?.textContent,
	};
}

describe("BashRenderer code card", () =>
{
	it("draws the prompt and command in the shared code tile with the Copy in its first-line action column", () =>
	{
		const {container} = render(<BashRenderer toolCall={CALL} />);

		const header = container.firstElementChild;
		expect(
			{
				...layout(container),
				header:
				{
					className: header?.className,
					text: header?.textContent,
				},
				label: header?.firstElementChild?.className,
			},
		).toStrictEqual(
			{
				header:
				{
					className: "flex items-center px-p6 py-p5",
					text: "Bash",
				},
				label: "flex-1 text-body text-secondary",
				body: "flex flex-col px-md pb-lg epitaxy-code-size gap-md text-code",
				card: CARD,
				cardText: "$\u{a0}git status",
				action: "flex h-[1lh] shrink-0 items-center gap-1",
				copyInAction: true,
				output: "max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-secondary",
				outputText: "nothing to commit",
			},
		);
	});

	it("uses the same tile inside a grouped row, with the Copy still inside it", () =>
	{
		const {container} = render(<BashRenderer toolCall={CALL} nested />);

		expect(layout(container)).toStrictEqual(
			{
				body: "flex-1 min-w-0 flex flex-col justify-center epitaxy-code-size gap-md text-code",
				card: CARD,
				cardText: "$\u{a0}git status",
				action: "flex h-[1lh] shrink-0 items-center gap-1",
				copyInAction: true,
				output: "max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-secondary",
				outputText: "nothing to commit",
			},
		);
	});
	it("scrolls a command over 300 characters in the Command frame, but not a short multi-line one", () =>
	{
		const framed = (command: string, nested: boolean) =>
		{
			const {container} = render(
				<BashRenderer
					toolCall={
					{
						...CALL,
						input:
						{
							command,
						},
					}}
					nested={nested}
				/>,
			);
			const found = container.querySelector(".epitaxy-code-card [role=group][aria-label=Command]") !== null;
			cleanup();
			return found;
		};
		expect([framed("x".repeat(301), false), framed("x".repeat(301), true), framed("a\nb\nc", false)]).toStrictEqual(
			[true, true, false],
		);
	});

	it("copies only the command as upstream `jy`'s Copy command, always visible while the call runs", async () =>
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
		const wrappers: (string | undefined)[] = [];
		const copy = async (call: ClientToolCall) =>
		{
			const {container} = render(<BashRenderer toolCall={call} />);
			const button = container.querySelector<HTMLElement>("button[aria-label='Copy command']")!;
			wrappers.push(button.closest(".epitaxy-code-card > .gap-1 > div")?.className);
			fireEvent.click(button);
			await act(async () =>
			{
				await Promise.resolve();
			});
			cleanup();
		};
		await copy(CALL);
		const {result: _result, ...noResult} = CALL;
		await copy(noResult);
		await copy(
			{
				...CALL,
				result: "$ git status\n\u001b[31mred\u001b[0m",
			},
		);
		expect(
			{
				writes: writeText.mock.calls,
				runningWrapper: wrappers[1],
				finishedVisible: wrappers[0] === "shrink-0",
			},
		).toStrictEqual(
			{
				writes: [["git status"], ["git status"], ["git status"]],
				runningWrapper: "shrink-0",
				finishedVisible: false,
			},
		);
	});

	it("shows a policy-blocked command's invisible characters, and leaves an unblocked one raw", () =>
	{
		const command = "rm\u200B -rf x";
		const tileText = (blocked: boolean) =>
		{
			const {container} = render(
				<BashRenderer
					toolCall={
					{
						...CALL,
						input:
						{
							command,
						},
						...(blocked
							?
								{
									blocked: true,
								}
							: {}),
					}}
				/>,
			);
			const text = container.querySelector(".epitaxy-code-card > .min-w-0")?.textContent;
			cleanup();
			return text;
		};
		expect([tileText(true), tileText(false)]).toStrictEqual(["rm[U+200B] -rf x", command]);
	});
});
