// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {type HardBlockHost, resetHardBlockOpenMemory} from "../src/components/hard-block-host";
import {MessageBlockedCard} from "../src/components/message-blocked-card";
import type {HardBlock} from "../src/lib/hard-block";

afterEach(() =>
{
	cleanup();
	resetHardBlockOpenMemory();
});

const BLOCK: HardBlock =
{
	uuid: "r1",
	model: "claude-opus-4-5-20251101",
	hasMessage: true,
};

function host(overrides: Partial<HardBlockHost> = {}): HardBlockHost
{
	return {
		latest: BLOCK,
		blockAt: (uuid) =>
			uuid === "r0"
				?
					{
						uuid: "r0",
						model: null,
						hasMessage: false,
					}
				: null,
		held: false,
		onEditRetry: vi.fn<(uuid: string) => boolean>(() => true),
		editRetryBusyFor: null,
		...overrides,
	};
}

function card(value: HardBlockHost, uuid = "r1")
{
	return render(<MessageBlockedCard host={value} uuid={uuid} fallback={<div data-testid="legacy" />} />);
}

function disclosure(): HTMLElement
{
	return screen.getByRole(
		"button",
		{
			name: "Message blocked",
		},
	);
}

describe("MessageBlockedCard", () =>
{
	it("draws the live card expanded with upstream's tree and Edit and retry", () =>
	{
		const {container} = card(host());
		const root = container.querySelector('[data-testid="hard-block-card"]');
		const toggle = disclosure();
		const panel = container.querySelector(`#${toggle.getAttribute("aria-controls") ?? "missing"}`);
		const caret = toggle.querySelector('[data-cds="Icon"]');
		expect(
			{
				cds: root?.getAttribute("data-cds"),
				role: root?.getAttribute("role"),
				variant: root?.getAttribute("data-banner-variant"),
				root: root?.className.split(" ").slice(0, 10).join(" "),
				iconSlot: root?.children[0]?.className,
				column: root?.children[1]?.className,
				collapsible: root?.children[1]?.children[0]?.getAttribute("data-cds"),
				header: toggle.parentElement?.className,
				toggle: toggle.className,
				expanded: toggle.getAttribute("aria-expanded"),
				ariaDisabled: toggle.getAttribute("aria-disabled"),
				title: toggle.children[0]?.outerHTML,
				caret: caret
					?.getAttribute("class")
					?.split(" ")
					.filter((c) => !c.startsWith("lucide"))
					.join(" "),
				panelTail: panel?.className.split(" ").slice(-2).join(" "),
				inner: panel?.children[0]?.className,
				details: panel?.children[0]?.children[0]?.className,
				body: panel?.querySelector("p")?.textContent,
				actions: panel?.querySelector("p")?.nextElementSibling?.className,
				buttons: screen.getAllByRole("button").map((button) => button.textContent),
			},
		).toStrictEqual(
			{
				cds: "Banner",
				role: null,
				variant: "neutral",
				root: "flex items-start gap-xs !py-lg font-sans text-body font-normal break-words px-lg rounded-card",
				iconSlot: "flex min-h-[1lh] shrink-0 items-center text-secondary",
				column: "flex min-w-0 flex-1 flex-col",
				collapsible: "Collapsible",
				header: "flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md",
				toggle: "cds-reset flex min-w-0 grow select-none items-center gap-x-[2px] border-0 text-start outline-none focus-visible:shadow-focus focus-visible:outline-hidden rounded transition-shadow duration-fast",
				expanded: "true",
				ariaDisabled: "false",
				title: '<div class="min-w-0">Message blocked</div>',
				caret: "transition-transform duration-fast motion-reduce:transition-none text-secondary",
				panelTail: "w-full text-secondary",
				inner: "pt-[var(--cds-gap-xs)]",
				details: "flex flex-col items-start gap-sm",
				body: "Opus 4.5’s safeguards flagged this message. This sometimes happens with safe, normal conversations.",
				actions: "flex flex-wrap items-center gap-sm",
				buttons: ["Message blocked", "Edit and retry"],
			},
		);
	});

	it("collapses an older refusal without Edit and retry, using upstream's no-model copy", () =>
	{
		card(host(), "r0");
		const toggle = disclosure();
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(toggle);
		expect(
			{
				expanded: toggle.getAttribute("aria-expanded"),
				body: document.querySelector('[data-testid="hard-block-card"] p')?.textContent,
				buttons: screen.getAllByRole("button").map((button) => button.textContent),
			},
		).toStrictEqual(
			{
				expanded: "true",
				body: "This model's safeguards flagged this message. This sometimes happens with safe, normal conversations.",
				buttons: ["Message blocked"],
			},
		);
	});

	it("draws the legacy card when no block matches the row", () =>
	{
		card(host(), "other");
		expect(
			{
				legacy: screen.queryByTestId("legacy") !== null,
				card: screen.queryByTestId("hard-block-card"),
			},
		).toStrictEqual(
			{
				legacy: true,
				card: null,
			},
		);
	});

	it("drops Edit and retry when the host has no handler, the session is held, or the prompt moved on", () =>
	{
		const names = (value: HardBlockHost) =>
		{
			const view = card(value);
			const result = view.queryByRole(
				"button",
				{
					name: "Edit and retry",
				},
			);
			view.unmount();
			resetHardBlockOpenMemory();
			return result;
		};
		expect(
			{
				noHandler: names(
					host(
						{
							onEditRetry: undefined,
						},
					),
				),
				held: names(
					host(
						{
							held: true,
						},
					),
				),
				moved: names(
					host(
						{
							latest:
							{
								...BLOCK,
								hasMessage: false,
							},
						},
					),
				),
			},
		).toStrictEqual(
			{
				noHandler: null,
				held: null,
				moved: null,
			},
		);
	});

	it("toggles the disclosure and rotates the caret, remembering the choice per uuid", () =>
	{
		const first = card(host());
		const toggle = disclosure();
		fireEvent.click(toggle);
		const caret = toggle.querySelector('[data-cds="Icon"]')?.getAttribute("class") ?? "";
		expect(
			{
				expanded: toggle.getAttribute("aria-expanded"),
				caret: caret
					.split(" ")
					.filter((c) => !c.startsWith("lucide"))
					.join(" "),
			},
		).toStrictEqual(
			{
				expanded: "false",
				caret: "transition-transform duration-fast motion-reduce:transition-none -rotate-90 page-rtl:rotate-90 text-secondary",
			},
		);
		first.unmount();
		card(host());
		expect(disclosure().getAttribute("aria-expanded")).toBe("false");
	});

	it("calls the handler with the card's uuid", () =>
	{
		const onEditRetry = vi.fn<(uuid: string) => boolean>(() => true);
		card(
			host(
				{
					onEditRetry,
				},
			),
		);
		act(() =>
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Edit and retry",
					},
				),
			);
		});
		expect(onEditRetry.mock.calls).toStrictEqual([["r1"]]);
	});

	it("marks Edit and retry busy while this card's rewind runs, ignoring clicks", () =>
	{
		const onEditRetry = vi.fn<(uuid: string) => boolean>(() => true);
		const {container} = card(
			host(
				{
					onEditRetry,
					editRetryBusyFor: "r1",
				},
			),
		);
		const button = [...container.querySelectorAll("button")].find((each) => each.textContent === "Edit and retry");
		fireEvent.click(button ?? document.body);
		expect(
			{
				busy: button?.getAttribute("aria-busy"),
				disabled: button?.getAttribute("aria-disabled"),
				label: button?.children[0]?.className,
				calls: onEditRetry.mock.calls.length,
			},
		).toStrictEqual(
			{
				busy: "true",
				disabled: "true",
				label: "inline-flex min-w-0 items-center gap-1 opacity-0",
				calls: 0,
			},
		);
	});
});
