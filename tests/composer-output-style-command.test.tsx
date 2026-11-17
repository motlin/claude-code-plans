// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import type {OutputStyleItem} from "../src/lib/output-style-options";

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
});

const ITEMS: OutputStyleItem[] = [
	{
		name: "default",
		label: "Default",
		checked: true,
	},
	{
		name: "Learning",
		label: "Learning",
		checked: false,
	},
];

let toasts: Omit<ToastOptions, "action">[] = [];
let actions: (() => void)[] = [];

function recordToast({action, ...options}: ToastOptions): void
{
	toasts.push(
		action === undefined
			? options
			:
				{
					...options,
					description: `action:${action.label}`,
				},
	);
	if (action !== undefined) actions.push(action.onAction);
}

/** Sends each text from a home or session composer with the host's output-style, memory and connectors hooks. */
function send(variant: "home" | "session", texts: readonly string[])
{
	const onSend = vi.fn<(prompt: string) => void>();
	toasts = [];
	actions = [];
	const calls: string[] = [];
	render(
		<ToastContext.Provider value={recordToast}>
			<Composer
				variant={variant}
				draftKey={`${variant}-alice`}
				onSend={(prompt) =>
				{
					onSend(prompt);
				}}
				outputStyle={
					variant === "session"
						?
							{
								hasSession: true,
								items: ITEMS,
								booting: false,
								open: () =>
								{
									calls.push("open-style");
								},
							}
						:
							{
								hasSession: false,
								openSettings: () =>
								{
									calls.push("style-settings");
								},
							}
				}
				{...(variant === "session"
					?
						{
							memory:
							{
								open: () =>
								{
									calls.push("open-memory");
								},
							},
						}
					: {})}
				openConnectors={() =>
				{
					calls.push("connectors");
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
	const drafts: string[] = [];
	for (const text of texts)
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
		drafts.push(textarea.value);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "",
				},
			},
		);
	}
	for (const action of actions) action();
	return {
		sent: onSend.mock.calls.map(([prompt]) => prompt),
		calls,
		toasts,
		drafts,
	};
}

describe("Composer /output-style, /memory and /mcp", () =>
{
	it("routes them from a session composer", () =>
	{
		expect(
			send("session", [
				"/output-style",
				"/output-style zzz",
				"/output-style learning",
				"/output-style default",
				"/memory",
				"/memory foo",
				"/memoryx",
				" /mcp ",
				"/mcp list",
			]),
		).toStrictEqual(
			{
				sent: ["/output-style Learning", "/memoryx", "/mcp list"],
				calls: ["open-style", "open-memory", "open-memory", "connectors"],
				toasts: [
					{
						kind: "error",
						message: "“zzz” isn’t an available output style.",
					},
					{
						kind: "success",
						message: "Output style already set to Default.",
					},
				],
				drafts: ["", "/output-style zzz", "", "", "", "", "", "", ""],
			},
		);
	});

	it("warns before the session starts on the home composer, keeping the text, and still opens Connectors", () =>
	{
		expect(send("home", ["/output-style Learning", "/memory", "/mcp"])).toStrictEqual(
			{
				sent: [],
				calls: ["connectors", "style-settings"],
				toasts: [
					{
						kind: "warning",
						message: "Set the output style in settings. This session uses it when it starts.",
						description: "action:Open settings",
					},
					{
						kind: "warning",
						message:
							"The Memory dialog works once this session starts. Send your first message to start it.",
					},
				],
				drafts: ["/output-style Learning", "/memory", ""],
			},
		);
	});
});
