// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {ToastProvider} from "../src/components/toast";
import {BUILTIN_SLASH_COMMANDS, type SlashCommand} from "../src/lib/slash-commands";

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
});

const TRAILING = "/skills doesn’t take arguments here. Remove the text after the command, then send it again.";
const EXTRA_LINES = "/skills only works on a single line. Remove the extra lines, then send it again.";

function setup({
	slashCommands = [],
	variant = "session",
	opener = true,
}:
{
	slashCommands?: readonly SlashCommand[];
	variant?: "session" | "home";
	opener?: boolean;
} = {})
{
	const onSend = vi.fn<(prompt: string, launchOptions: unknown, routing?: unknown) => void>();
	const open = vi.fn<() => void>();
	render(
		<ToastProvider>
			<Composer
				variant={variant}
				draftKey={`${variant}-skills`}
				onSend={onSend}
				slashCommands={slashCommands}
				{...(opener
					?
						{
							openSkills: open,
						}
					: {})}
			/>
		</ToastProvider>,
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
	return {
		textarea,
		onSend,
		open,
	};
}

function send(textarea: HTMLTextAreaElement, text: string)
{
	fireEvent.change(
		textarea,
		{
			target:
			{
				value: text,
			},
		},
	);
	fireEvent.keyDown(
		textarea,
		{
			key: "Enter",
		},
	);
}

function outcome({textarea, onSend, open}: ReturnType<typeof setup>, band?: string)
{
	return {
		sends: onSend.mock.calls.map((call) => call[0]),
		opens: open.mock.calls.length,
		text: textarea.value,
		band: band === undefined ? null : (screen.queryByText(band)?.textContent ?? null),
	};
}

describe("/skills", () =>
{
	it("opens the Skills list and clears the composer instead of sending", () =>
	{
		const harness = setup();

		send(harness.textarea, "/skills");

		expect(outcome(harness)).toStrictEqual(
			{
				sends: [],
				opens: 1,
				text: "",
				band: null,
			},
		);
	});

	it("lets /skills with text reach the CLI when the CLI lists its own /skills", () =>
	{
		const harness = setup(
			{
				slashCommands: BUILTIN_SLASH_COMMANDS,
			},
		);

		send(harness.textarea, "/skills foo");

		expect(outcome(harness)).toStrictEqual(
			{
				sends: ["/skills foo"],
				opens: 0,
				text: "",
				band: null,
			},
		);
	});

	it("shows the noArgs band and keeps the text when no command list has loaded", () =>
	{
		const harness = setup();

		send(harness.textarea, "/skills foo");

		expect(outcome(harness, TRAILING)).toStrictEqual(
			{
				sends: [],
				opens: 0,
				text: "/skills foo",
				band: TRAILING,
			},
		);
	});

	it("shows the single-line band for a multi-line /skills when no command list has loaded", () =>
	{
		const harness = setup();

		send(harness.textarea, "/skills\nfoo");

		expect(outcome(harness, EXTRA_LINES)).toStrictEqual(
			{
				sends: [],
				opens: 0,
				text: "/skills\nfoo",
				band: EXTRA_LINES,
			},
		);
	});

	it("sends /skills to the CLI as typed where nothing can open the Skills list", () =>
	{
		const harness = setup(
			{
				opener: false,
			},
		);

		send(harness.textarea, "/skills");

		expect(outcome(harness).sends).toStrictEqual(["/skills"]);
	});

	it("opens the Skills list from the home draft without launching a session", () =>
	{
		const harness = setup(
			{
				variant: "home",
			},
		);

		send(harness.textarea, "/skills");

		expect(outcome(harness)).toStrictEqual(
			{
				sends: [],
				opens: 1,
				text: "",
				band: null,
			},
		);
	});
});
