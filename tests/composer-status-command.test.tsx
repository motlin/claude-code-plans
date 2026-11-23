// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
});

function setup(variant: "session" | "home", turnActive = false)
{
	const handlers =
	{
		onSend: vi.fn<(prompt: string) => void>(),
		show: vi.fn<(text: string) => void>(),
		toast: vi.fn<(options: ToastOptions) => void>(),
	};
	const element = (active: boolean) => (
		<ToastContext.Provider value={handlers.toast}>
			<Composer
				variant={variant}
				draftKey={variant === "home" ? "home" : "session-alice"}
				onSend={(prompt) =>
				{
					handlers.onSend(prompt);
				}}
				statusCommand={
					variant === "session"
						?
							{
								turnActive: active,
								show: handlers.show,
							}
						: undefined
				}
			/>
		</ToastContext.Provider>
	);
	const {rerender} = render(element(turnActive));
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
	function submit(text: string)
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
	return {
		handlers,
		textarea,
		submit,
		setTurnActive: (active: boolean) =>
		{
			rerender(element(active));
		},
	};
}

function outcome({handlers, textarea}: ReturnType<typeof setup>)
{
	const notice = document.querySelector<HTMLElement>("[data-composer-command-notice]");
	return {
		notice: notice === null ? null : notice.textContent,
		onSend: [...handlers.onSend.mock.calls],
		show: [...handlers.show.mock.calls],
		toast: [...handlers.toast.mock.calls],
		text: textarea.value,
	};
}

describe("/status", () =>
{
	it("shows the Session info card on an idle session instead of sending, and clears the composer", () =>
	{
		const composer = setup("session");
		composer.submit("  /status ");

		expect(outcome(composer)).toStrictEqual(
			{
				notice: null,
				onSend: [],
				show: [["/status"]],
				toast: [],
				text: "",
			},
		);
	});

	it("notes mid-turn in the composer dock instead of toasting, keeps the text, and clears when the turn ends", () =>
	{
		const composer = setup("session", true);
		composer.submit("/status");
		const noted = outcome(composer);
		composer.setTurnActive(false);

		expect(
			{
				noted,
				ended: outcome(composer),
			},
		).toStrictEqual(
			{
				noted:
				{
					notice: "Session info is available when Claude finishes this turn.",
					onSend: [],
					show: [],
					toast: [],
					text: "/status",
				},
				ended:
				{
					notice: null,
					onSend: [],
					show: [],
					toast: [],
					text: "/status",
				},
			},
		);
	});

	it("clears the mid-turn note on the next send", () =>
	{
		const composer = setup("session", true);
		composer.submit("/status");
		composer.submit("hello");

		expect(outcome(composer)).toStrictEqual(
			{
				notice: null,
				onSend: [["hello"]],
				show: [],
				toast: [],
				text: "",
			},
		);
	});

	it("notes on the home composer without starting a session or toasting, and keeps the text", () =>
	{
		const composer = setup("home");
		composer.submit("/status");

		expect(outcome(composer)).toStrictEqual(
			{
				notice: "Session info is available once the session starts.",
				onSend: [],
				show: [],
				toast: [],
				text: "/status",
			},
		);
	});

	it("bands trailing arguments, keeping the text, and leaves /statusline to the CLI", () =>
	{
		const composer = setup("session");
		composer.submit("/status foo");
		const band = screen.getByText(
			"/status doesn’t take arguments here. Remove the text after the command, then send it again.",
		);
		const banded = outcome(composer);
		composer.submit("/statusline");

		expect(
			{
				band: band.textContent,
				banded,
				after: outcome(composer),
			},
		).toStrictEqual(
			{
				band: "/status doesn’t take arguments here. Remove the text after the command, then send it again.",
				banded:
				{
					notice: null,
					onSend: [],
					show: [],
					toast: [],
					text: "/status foo",
				},
				after:
				{
					notice: null,
					onSend: [["/statusline"]],
					show: [],
					toast: [],
					text: "",
				},
			},
		);
	});
});
