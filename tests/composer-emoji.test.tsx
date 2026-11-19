// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";

// Load the deferred composer chunks up front, as the page warms them before first use, so a download one of these tests
// starts cannot land after this file's environment is torn down.
beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
});

function renderComposer({
	onShellCommand,
	promptHistory,
}:
{
	onShellCommand?: (command: string) => Promise<boolean>;
	promptHistory?: readonly string[];
} = {}): HTMLTextAreaElement
{
	render(
		<Composer
			variant="session"
			draftKey="session-alice"
			onSend={() =>
			{
			}}
			onShellCommand={onShellCommand}
			promptHistory={promptHistory}
		/>,
	);
	return screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
}

/** One change event per typed character, each with the caret at the end, as a keyboard produces. */
function typeChars(textarea: HTMLTextAreaElement, text: string)
{
	for (const char of text)
	{
		const value = textarea.value + char;
		fireEvent.change(
			textarea,
			{
				target:
				{
					value,
				},
			},
		);
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	}
}

function state(textarea: HTMLTextAreaElement)
{
	return {
		value: textarea.value,
		caret: textarea.selectionStart,
	};
}

function backspace(textarea: HTMLTextAreaElement): boolean
{
	return fireEvent.keyDown(
		textarea,
		{
			key: "Backspace",
		},
	);
}

describe("Composer emoticon auto-replace", () =>
{
	it("turns an emoticon into an emoji on the next space, and Backspace right after reverts it", () =>
	{
		const textarea = renderComposer();
		typeChars(textarea, "x :) ");
		const converted = state(textarea);
		const notPrevented = backspace(textarea);
		expect(
			{
				converted,
				reverted: state(textarea),
				notPrevented,
			},
		).toEqual(
			{
				converted:
				{
					value: "x \u{1F642} ",
					caret: 5,
				},
				reverted:
				{
					value: "x :) ",
					caret: 5,
				},
				notPrevented: false,
			},
		);
	});

	it("leaves Backspace alone once something else was typed after the conversion", () =>
	{
		const textarea = renderComposer();
		typeChars(textarea, "x :) y");
		expect(
			{
				value: textarea.value,
				notPrevented: backspace(textarea),
			},
		).toEqual(
			{
				value: "x \u{1F642} y",
				notPrevented: true,
			},
		);
	});

	it("converts at a line start after a newline, and leaves a glued emoticon", () =>
	{
		const textarea = renderComposer();
		typeChars(textarea, "hi:) and\n:D ");
		expect(textarea.value).toBe("hi:) and\n\u{1F603} ");
	});

	it("leaves a pasted emoticon unchanged", () =>
	{
		const textarea = renderComposer();
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: ":) ",
				},
			},
		);
		expect(textarea.value).toBe(":) ");
	});

	it("is off in bash mode", () =>
	{
		const textarea = renderComposer(
			{
				onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "!",
			},
		);
		typeChars(textarea, "echo :) ");
		expect(textarea.value).toBe("echo :) ");
	});

	it("is off while a recalled history entry is showing", () =>
	{
		const textarea = renderComposer(
			{
				promptHistory: ["x :)"],
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowUp",
			},
		);
		textarea.setSelectionRange(4, 4);
		typeChars(textarea, " ");
		expect(textarea.value).toBe("x :) ");
	});
});
