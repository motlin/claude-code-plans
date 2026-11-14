// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

const clipboard = vi.hoisted(() => (
{
	writeClipboardText: vi.fn<(text: string) => Promise<boolean>>(),
}));
vi.mock("../src/lib/clipboard", () => clipboard);

import {HookBlockedPromptCard, HookBlockedPromptMarker} from "../src/components/hook-blocked-prompt";

afterEach(() =>
{
	cleanup();
	clipboard.writeClipboardText.mockReset();
});

const buttonNames = () =>
	screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);

describe("HookBlockedPromptCard", () =>
{
	it("shows upstream's headline with the reason as the hint", () =>
	{
		const {container} = render(
			<HookBlockedPromptCard entryKey="k-hint" reason=" worker unreachable " originalPrompt="orig" />,
		);
		const card = container.querySelector("[data-hook-blocked-card]");
		expect(
			{
				headline: card?.firstElementChild?.textContent,
				hint: card?.children[1]?.textContent,
			},
		).toStrictEqual(
			{
				headline: "A hook blocked your prompt",
				hint: "worker unreachable",
			},
		);
	});

	it("falls back to upstream's hint when the reason is blank", () =>
	{
		const {container} = render(<HookBlockedPromptCard entryKey="k-blank" reason="  " />);
		expect(container.querySelector("[data-hook-blocked-card]")?.children[1]?.textContent).toStrictEqual(
			"A UserPromptSubmit hook stopped this prompt before it reached Claude.",
		);
	});

	it("reveals and copies the original prompt under View details", async () =>
	{
		clipboard.writeClipboardText.mockResolvedValue(true);
		const {container} = render(
			<HookBlockedPromptCard entryKey="k-details" reason="worker unreachable" originalPrompt="what's next?" />,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View details",
				},
			),
		);
		expect(container.querySelector("[data-api-error-details] span")?.textContent).toStrictEqual("what's next?");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Copy details",
				},
			),
		);
		await Promise.resolve();
		expect(clipboard.writeClipboardText.mock.calls).toStrictEqual([["what's next?"]]);
	});

	it("draws no details row without an original prompt or an Edit prompt action", () =>
	{
		const {container} = render(<HookBlockedPromptCard entryKey="k-none" reason="nope" />);
		expect(
			{
				buttons: buttonNames(),
				children: container.querySelector("[data-hook-blocked-card]")?.children.length,
			},
		).toStrictEqual(
			{
				buttons: [],
				children: 2,
			},
		);
	});

	it("gives no Edit prompt without a handler", () =>
	{
		render(<HookBlockedPromptCard entryKey="k-nohandler" reason="nope" originalPrompt="orig" />);
		expect(buttonNames()).toStrictEqual(["View details"]);
	});

	it("hides Edit prompt after a successful prefill, even across remounts", () =>
	{
		const onEditPrompt = vi.fn<(text: string) => boolean>(() => true);
		const first = render(
			<HookBlockedPromptCard entryKey="k-edit" reason="nope" originalPrompt="orig" onEditPrompt={onEditPrompt} />,
		);
		expect(buttonNames()).toStrictEqual(["View details", "Edit prompt"]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Edit prompt",
				},
			),
		);
		expect(
			{
				calls: onEditPrompt.mock.calls,
				buttons: buttonNames(),
			},
		).toStrictEqual(
			{
				calls: [["orig"]],
				buttons: ["View details"],
			},
		);
		first.unmount();
		render(
			<HookBlockedPromptCard entryKey="k-edit" reason="nope" originalPrompt="orig" onEditPrompt={onEditPrompt} />,
		);
		expect(buttonNames()).toStrictEqual(["View details"]);
	});

	it("keeps Edit prompt when the prefill is refused", () =>
	{
		const onEditPrompt = vi.fn<(text: string) => boolean>(() => false);
		render(
			<HookBlockedPromptCard
				entryKey="k-refused"
				reason="nope"
				originalPrompt="orig"
				onEditPrompt={onEditPrompt}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Edit prompt",
				},
			),
		);
		expect(
			{
				calls: onEditPrompt.mock.calls,
				buttons: buttonNames(),
			},
		).toStrictEqual(
			{
				calls: [["orig"]],
				buttons: ["View details", "Edit prompt"],
			},
		);
	});
});

describe("HookBlockedPromptMarker", () =>
{
	it("shows the label and the reason in its details panel", () =>
	{
		const {container} = render(<HookBlockedPromptMarker reason=" worker unreachable " />);
		const marker = container.querySelector("[data-hook-blocked-marker]");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View details",
				},
			),
		);
		expect(
			{
				root: marker?.className,
				label: marker?.firstElementChild?.textContent,
				icon: marker?.querySelector("svg")?.getAttribute("class"),
				body: container.querySelector("[data-api-error-details] span")?.textContent,
			},
		).toStrictEqual(
			{
				root: "flex w-full max-w-[480px] flex-col items-start gap-1 self-start ps-[var(--cds-assistant-message-text-inset,0px)]",
				label: "Prompt blocked by a hook",
				icon: "lucide lucide-triangle-exclamation-point lucide-alert-triangle lucide-triangle-alert size-4 shrink-0 text-danger-000",
				body: "worker unreachable",
			},
		);
	});

	it("gives no View details for an empty reason", () =>
	{
		render(<HookBlockedPromptMarker reason="  " />);
		expect(buttonNames()).toStrictEqual([]);
	});
});
