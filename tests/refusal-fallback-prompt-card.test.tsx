// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {RefusalFallbackPromptCard} from "../src/components/approval-card";
import type {HerdrRefusalFallbackDialog, RefusalFallbackChoice} from "../src/lib/api/herdr";

afterEach(cleanup);

const DIALOG: HerdrRefusalFallbackDialog =
{
	body: "Opus 4.7's safeguards flagged this message.",
	guidance: null,
	category: "cyber",
	switchLabel: "Switch to Sonnet 4.6",
	switchRow: 1,
	editLabel: "Edit prompt and retry with Opus 4.7",
	editRow: 2,
	focus: "switch",
};

function buttons()
{
	return screen.getAllByRole("button").map((button) => (
	{
		name: button.getAttribute("aria-label") ?? button.textContent,
		busy: button.getAttribute("aria-busy") === "true",
		disabled: button.hasAttribute("disabled"),
	}));
}

function disabledReasons(): string[]
{
	return [...document.querySelectorAll("[data-cds-disabled-reason]")].map((node) => node.textContent);
}

describe("RefusalFallbackPromptCard", () =>
{
	it("draws upstream's Session paused card: fallback copy, Learn more, Details and Edit before Switch", () =>
	{
		render(
			<RefusalFallbackPromptCard
				dialog={DIALOG}
				canEdit
				onChoose={vi.fn<(choice: RefusalFallbackChoice) => Promise<void>>()}
			/>,
		);
		const group = screen.getByRole("group");
		const link = screen.getByRole("link");
		expect(
			{
				label: group.getAttribute("aria-label"),
				buttons: buttons().map((button) => button.name),
				text: group.querySelector("[data-refusal-body]")?.textContent,
				link: [link.textContent, link.getAttribute("href"), link.getAttribute("target")],
				code: group.querySelector("code")?.textContent,
			},
		).toStrictEqual(
			{
				label: "Session paused",
				buttons: ["Dismiss", "Edit prompt and retry with Opus 4.7", "Switch to Sonnet 4.6"],
				text: "This model's safeguards flagged this message. This sometimes happens with safe, normal conversations. Learn more(opens in new tab).Details: [cyber]",
				link: ["Learn more(opens in new tab)", "https://support.claude.com/en/articles/8106465", "_blank"],
				code: "[cyber]",
			},
		);
	});

	it("offers only Switch when Edit is unavailable, and no Details without a category", () =>
	{
		render(
			<RefusalFallbackPromptCard
				dialog={
				{
					...DIALOG,
					category: null,
					guidance: "Try rephrasing.",
				}}
				canEdit={false}
				onChoose={vi.fn<(choice: RefusalFallbackChoice) => Promise<void>>()}
			/>,
		);
		expect(
			{
				buttons: buttons().map((button) => button.name),
				details: screen.queryByText(/Details/),
				guidance: screen.getByText("Try rephrasing.").tagName,
			},
		).toStrictEqual(
			{
				buttons: ["Dismiss", "Switch to Sonnet 4.6"],
				details: null,
				guidance: "P",
			},
		);
	});

	it("holds the other controls while a choice is sending, with X's reason Sending response…", () =>
	{
		const onChoose = vi.fn<(choice: RefusalFallbackChoice) => Promise<void>>(
			async () =>
				new Promise<void>(() =>
				{
					// Never settles: the choice stays in flight.
				}),
		);
		render(<RefusalFallbackPromptCard dialog={DIALOG} canEdit onChoose={onChoose} />);
		fireEvent.click(screen.getByText("Switch to Sonnet 4.6"));
		expect(
			{
				calls: onChoose.mock.calls,
				buttons: buttons(),
				reasons: disabledReasons(),
			},
		).toStrictEqual(
			{
				calls: [["retry_fallback"]],
				buttons: [
					{
						name: "Dismiss",
						busy: false,
						disabled: true,
					},
					{
						name: "Edit prompt and retry with Opus 4.7",
						busy: false,
						disabled: true,
					},
					{
						name: "Sending…",
						busy: true,
						disabled: false,
					},
				],
				reasons: ["Sending response…"],
			},
		);
	});

	it("X answers cancelled and Edit answers edit_prompt", () =>
	{
		const onChoose = vi.fn<(choice: RefusalFallbackChoice) => Promise<void>>(async () => Promise.resolve());
		render(<RefusalFallbackPromptCard dialog={DIALOG} canEdit onChoose={onChoose} />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dismiss",
				},
			),
		);
		cleanup();
		render(<RefusalFallbackPromptCard dialog={DIALOG} canEdit onChoose={onChoose} />);
		fireEvent.click(screen.getByText("Edit prompt and retry with Opus 4.7"));
		expect(onChoose.mock.calls).toStrictEqual([["cancelled"], ["edit_prompt"]]);
	});

	it("shows a refused choice's error and re-enables every control", async () =>
	{
		const onChoose = vi.fn<(choice: RefusalFallbackChoice) => Promise<void>>(async () =>
			Promise.reject(new Error("The terminal is not showing this dialog")),
		);
		render(<RefusalFallbackPromptCard dialog={DIALOG} canEdit onChoose={onChoose} />);
		await act(async () =>
		{
			fireEvent.click(screen.getByText("Switch to Sonnet 4.6"));
			await Promise.resolve();
		});
		expect(
			{
				alert: screen.getByRole("alert").textContent,
				buttons: buttons().map((button) => button.disabled || button.busy),
			},
		).toStrictEqual(
			{
				alert: "The terminal is not showing this dialog",
				buttons: [false, false, false],
			},
		);
	});
});
