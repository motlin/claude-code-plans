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
		openSettings: vi.fn<() => void>(),
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
				usageCommand={
				{
					turnActive,
					show: variant === "session" ? handlers.show : null,
					openSettings: handlers.openSettings,
				}}
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
		openSettings: handlers.openSettings.mock.calls.length,
		toast: [...handlers.toast.mock.calls],
		text: textarea.value,
	};
}

describe("/usage and /cost", () =>
{
	it("show the Usage card on an idle session instead of sending, with the command as typed, and clear the draft", () =>
	{
		const composer = setup("session");
		composer.submit(" /usage ");
		composer.submit("/cost");

		expect(outcome(composer)).toStrictEqual(
			{
				onSend: [],
				show: [["/usage"], ["/cost"]],
				openSettings: 0,
				toast: [],
				text: "",
			},
		);
	});

	it("open Settings › Usage mid-turn with no toast, clearing the draft", () =>
	{
		const composer = setup("session", true);
		composer.submit("/usage");

		expect(outcome(composer)).toStrictEqual(
			{
				onSend: [],
				show: [],
				openSettings: 1,
				toast: [],
				text: "",
			},
		);
	});

	it("open Settings › Usage on the home composer without starting a session", () =>
	{
		const composer = setup("home");
		composer.submit("/cost");

		expect(outcome(composer)).toStrictEqual(
			{
				onSend: [],
				show: [],
				openSettings: 1,
				toast: [],
				text: "",
			},
		);
	});

	it("band trailing arguments, keeping the text, and leave /stats to the CLI", () =>
	{
		const composer = setup("session");
		composer.submit("/usage foo");
		const band = screen.getByText(
			"/usage doesn’t take arguments here. Remove the text after the command, then send it again.",
		);
		const banded = outcome(composer);
		composer.submit("/stats");

		expect(
			{
				band: band.textContent,
				banded,
				after: outcome(composer),
			},
		).toStrictEqual(
			{
				band: "/usage doesn’t take arguments here. Remove the text after the command, then send it again.",
				banded:
				{
					onSend: [],
					show: [],
					openSettings: 0,
					toast: [],
					text: "/usage foo",
				},
				after:
				{
					onSend: [["/stats"]],
					show: [],
					openSettings: 0,
					toast: [],
					text: "",
				},
			},
		);
	});
});
