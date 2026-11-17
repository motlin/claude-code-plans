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
	render(
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
								turnActive,
								show: handlers.show,
							}
						: undefined
				}
			/>
		</ToastContext.Provider>,
	);
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
	};
}

function outcome({handlers, textarea}: ReturnType<typeof setup>)
{
	return {
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
				onSend: [],
				show: [["/status"]],
				toast: [],
				text: "",
			},
		);
	});

	it("toasts mid-turn and keeps the text", () =>
	{
		const composer = setup("session", true);
		composer.submit("/status");

		expect(outcome(composer)).toStrictEqual(
			{
				onSend: [],
				show: [],
				toast: [
					[
						{
							kind: "error",
							message: "Session info is available when Claude finishes this turn.",
							uniqueKey: "epitaxy-status-turn",
						},
					],
				],
				text: "/status",
			},
		);
	});

	it("toasts on the home composer without starting a session, and keeps the text", () =>
	{
		const composer = setup("home");
		composer.submit("/status");

		expect(outcome(composer)).toStrictEqual(
			{
				onSend: [],
				show: [],
				toast: [
					[
						{
							kind: "error",
							message: "Session info is available once the session starts.",
							uniqueKey: "epitaxy-status-session",
						},
					],
				],
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
					onSend: [],
					show: [],
					toast: [],
					text: "/status foo",
				},
				after:
				{
					onSend: [["/statusline"]],
					show: [],
					toast: [],
					text: "",
				},
			},
		);
	});
});
