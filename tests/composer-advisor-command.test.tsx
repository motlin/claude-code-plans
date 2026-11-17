// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
});

/** Sends each text from a session composer, with or without the host's advisor dialog. */
function send(texts: readonly string[], withAdvisor: boolean)
{
	const onSend = vi.fn<(prompt: string) => void>();
	const open = vi.fn<() => void>();
	render(
		<Composer
			variant="session"
			draftKey="session-alice"
			onSend={(prompt) =>
			{
				onSend(prompt);
			}}
			{...(withAdvisor
				?
					{
						advisor:
						{
							open,
						},
					}
				: {})}
		/>,
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
	}
	return {
		sent: onSend.mock.calls,
		opened: open.mock.calls.length,
		drafts,
	};
}

describe("Composer /advisor", () =>
{
	it("opens the host dialog for a bare /advisor and clears it, while arguments reach the CLI as typed", () =>
	{
		expect(send(["/advisor", " /ADVISOR ", "/advisor opus"], true)).toStrictEqual(
			{
				sent: [["/advisor opus"]],
				opened: 2,
				drafts: ["", "", ""],
			},
		);
	});

	it("sends a bare /advisor as typed when the session offers no dialog", () =>
	{
		expect(send(["/advisor"], false)).toStrictEqual(
			{
				sent: [["/advisor"]],
				opened: 0,
				drafts: [""],
			},
		);
	});
});
