// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ParkedMessageBar, type ParkedMessageBarProps} from "../src/components/parked-message-bar";
import {clearComposerQueues, type QueuedPrompt} from "../src/lib/composer-queue";

// 2:00 AM in New York; the reset at 4:00 AM is the same day there.
const NOW_MS = Date.UTC(2026, 10, 6, 7, 0);
const RESETS_AT = Date.UTC(2026, 10, 6, 9, 0) / 1000;

const ALICE: QueuedPrompt =
{
	id: "p1",
	text: "Alice's held follow-up",
	parked:
	{
		parkedAtMs: NOW_MS,
		parkedForResetsAt: RESETS_AT,
	},
};
const BOB: QueuedPrompt =
{
	id: "p2",
	text: "Bob's held follow-up",
	parked:
	{
		parkedAtMs: NOW_MS,
		parkedForResetsAt: RESETS_AT,
	},
};

beforeEach(() =>
{
	vi.useFakeTimers();
	vi.setSystemTime(NOW_MS);
});

afterEach(() =>
{
	cleanup();
	clearComposerQueues();
	vi.useRealTimers();
});

function renderBar(overrides: Partial<ParkedMessageBarProps> = {})
{
	const props: ParkedMessageBarProps =
	{
		sessionId: "session-parked",
		items: [ALICE],
		willAutoSend: true,
		resetsAt: RESETS_AT,
		archived: false,
		flushing: false,
		onSendAnyway: vi.fn<() => void>(),
		onEdit: vi.fn<(item: QueuedPrompt) => void>(),
		onRemove: vi.fn<(id: string) => void>(),
		timeZone: "America/New_York",
		...overrides,
	};
	const view = render(<ParkedMessageBar {...props} />);
	return {
		...view,
		props,
	};
}

function bandText(container: HTMLElement)
{
	const band = container.querySelector("[role=status]");
	return Array.from(band?.querySelectorAll("span.min-w-0") ?? []).map((span) => (
	{
		text: span.textContent,
		className: span.className,
	}));
}

describe("ParkedMessageBar", () =>
{
	it("shows the will-auto-send notice with today's reset above the joined queue list", () =>
	{
		const {container} = renderBar();
		const root = container.firstElementChild;
		const band = root?.firstElementChild;
		const button = screen.getByRole(
			"button",
			{
				name: "Send anyway",
			},
		);
		expect(
			{
				root: root?.className,
				band: band?.className.split(" ").includes("rounded-b-none"),
				icon: band?.querySelector("svg") ?? null,
				words: bandText(container),
				button:
				{
					text: button.textContent,
					disabled: button.hasAttribute("disabled"),
				},
				list: root?.lastElementChild?.firstElementChild?.className.includes("rounded-t-none border-t"),
				sendNow: screen.queryByRole(
					"button",
					{
						name: "Send now",
					},
				),
			},
		).toStrictEqual(
			{
				root: "flex w-full flex-col",
				band: true,
				icon: null,
				words: [
					{
						text: "You hit your usage limit. Held messages will send when it resets.",
						className: "min-w-0 text-primary",
					},
					{
						text: "Resets at 4:00 AM",
						className: "min-w-0 text-ink-muted",
					},
				],
				button:
				{
					text: "Send anyway",
					disabled: false,
				},
				list: true,
				sendNow: null,
			},
		);
	});

	it("says Send anyway sends held messages when nothing will auto-send, with no Clear all", () =>
	{
		const {container} = renderBar(
			{
				items: [ALICE, BOB],
				willAutoSend: false,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /2 messages queued/,
				},
			),
		);
		expect(
			{
				words: bandText(container).map((word) => word.text),
				clearAll: screen.queryByText("Clear all"),
			},
		).toStrictEqual(
			{
				words: ["You hit your usage limit. Send anyway sends held messages now.", "Resets at 4:00 AM"],
				clearAll: null,
			},
		);
	});

	it("drops the detail once the reset has passed", () =>
	{
		const {container} = renderBar(
			{
				resetsAt: NOW_MS / 1000 - 1,
			},
		);
		expect(bandText(container).map((word) => word.text)).toStrictEqual([
			"You hit your usage limit. Held messages will send when it resets.",
		]);
	});

	it("shows the archived copy with no detail and Send anyway disabled", () =>
	{
		const {container} = renderBar(
			{
				archived: true,
			},
		);
		expect(
			{
				words: bandText(container).map((word) => word.text),
				disabled: screen
					.getByRole(
						"button",
						{
							name: "Send anyway",
						},
					)
					.hasAttribute("disabled"),
			},
		).toStrictEqual(
			{
				words: ["This session is archived, so held messages won’t send. Unarchive it to send them."],
				disabled: true,
			},
		);
	});

	it("marks Send anyway busy and disabled while flushing", () =>
	{
		renderBar(
			{
				flushing: true,
			},
		);
		const button = screen.getByRole(
			"button",
			{
				name: "Send anyway",
			},
		);
		expect(
			{
				busy: button.getAttribute("aria-busy"),
				disabled: button.hasAttribute("disabled"),
			},
		).toStrictEqual(
			{
				busy: "true",
				disabled: true,
			},
		);
	});

	it("sends anyway on click and keeps focus on mouse down", () =>
	{
		const {props} = renderBar();
		const button = screen.getByRole(
			"button",
			{
				name: "Send anyway",
			},
		);
		const kept = fireEvent.mouseDown(button);
		fireEvent.click(button);
		expect(
			{
				kept,
				calls: vi.mocked(props.onSendAnyway).mock.calls,
			},
		).toStrictEqual(
			{
				kept: false,
				calls: [[]],
			},
		);
	});

	it("renders nothing without parked prompts", () =>
	{
		const {container} = renderBar(
			{
				items: [],
			},
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing when the parked prompts list in the transcript", () =>
	{
		const {container} = renderBar(
			{
				listInTranscript: true,
			},
		);
		expect(container.innerHTML).toBe("");
	});
});
