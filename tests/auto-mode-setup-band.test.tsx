// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {AutoModeSetupBand} from "../src/components/auto-mode-setup-band";
import type {AutoSetupBandInput} from "../src/lib/auto-mode-setup-band";

const NOW = 1_800_000_000_000;
const ELIGIBLE: AutoSetupBandInput =
{
	setup:
	{
		offered: true,
		setupComplete: false,
		denials: 5,
		dismissed: false,
		snoozedUntil: 0,
	},
	autoModeIsDefault: true,
	paneWritable: true,
	effectiveMode: "auto",
	sessionHistoryCount: 3,
	bandSeen: false,
	coachSeenAt: 0,
	now: NOW,
};
const MESSAGE = "Auto mode works better when it knows your environment. Takes about a minute.";

afterEach(cleanup);

function childAt(parent: Element, index: number): Element
{
	const child = parent.children.item(index);
	if (child === null) throw new Error(`No child ${index} under ${parent.outerHTML}`);
	return child;
}

function renderBand(input: AutoSetupBandInput | null = ELIGIBLE)
{
	const sendLive = vi.fn<(prompt: string) => void>();
	const markSeen = vi.fn<() => void>();
	const view = render(<AutoModeSetupBand input={input} sendLive={sendLive} markSeen={markSeen} />);
	return {
		...view,
		sendLive,
		markSeen,
	};
}

describe("AutoModeSetupBand", () =>
{
	it("draws upstream's neutral cds Banner card with the Trust icon, a secondary Start and a Dismiss", () =>
	{
		const {container} = renderBand();
		const root = childAt(container, 0);
		const card = childAt(root, 0);
		const [iconSlot, body, dismissSlot] = [childAt(card, 0), childAt(card, 1), childAt(card, 2)];
		const [words, actions] = [childAt(body, 0), childAt(body, 1)];
		const wordsRow = childAt(words, 0);
		const start = childAt(actions, 0);
		expect(
			{
				root: [root.getAttribute("role"), root.getAttribute("aria-live"), root.className, root.children.length],
				card: [
					card.getAttribute("data-cds"),
					card.getAttribute("data-banner-variant"),
					card.getAttribute("data-composer-keyline"),
					card.getAttribute("role"),
				],
				icon: [iconSlot.className, childAt(iconSlot, 0).getAttribute("class")],
				words: [wordsRow.className, childAt(wordsRow, 0).className, words.textContent],
				start: [
					start.getAttribute("data-cds"),
					start.getAttribute("aria-label"),
					start.textContent,
					actions.children.length,
				],
				dismiss: childAt(dismissSlot, 0).getAttribute("aria-label"),
				oldShell: container.querySelectorAll(".bg-alpha-1").length,
			},
		).toStrictEqual(
			{
				root: ["status", "polite", "w-full band-enter", 1],
				card: ["Banner", "neutral", "glyph", null],
				icon: [
					"flex min-h-[1lh] shrink-0 items-center ms-[4px] -me-[4px] text-secondary",
					"lucide lucide-shield-check",
				],
				words: ["flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75", "min-w-0", MESSAGE],
				start: ["Button", null, "Start", 1],
				dismiss: "Dismiss",
				oldShell: 0,
			},
		);
	});

	it("marks itself seen once when it first shows, and stays up for this mount", () =>
	{
		const {rerender, markSeen, sendLive} = renderBand();
		rerender(
			<AutoModeSetupBand
				input={
				{
					...ELIGIBLE,
					bandSeen: true,
				}}
				sendLive={sendLive}
				markSeen={markSeen}
			/>,
		);
		expect([markSeen.mock.calls.length, screen.queryByText(MESSAGE)?.tagName]).toStrictEqual([1, "SPAN"]);
	});

	it("renders nothing on a later mount once seen", () =>
	{
		const {container, markSeen} = renderBand(
			{
				...ELIGIBLE,
				bandSeen: true,
			},
		);
		expect([container.innerHTML, markSeen.mock.calls.length]).toStrictEqual(["", 0]);
	});

	it("types /auto-mode-setup into the pane on Start, then hides", () =>
	{
		const {container, sendLive} = renderBand();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Start",
				},
			),
		);
		expect([sendLive.mock.calls, container.innerHTML]).toStrictEqual([[["/auto-mode-setup"]], ""]);
	});

	it("hides on Dismiss without typing anything", () =>
	{
		const {container, sendLive} = renderBand();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dismiss",
				},
			),
		);
		expect([sendLive.mock.calls, container.innerHTML]).toStrictEqual([[], ""]);
	});

	it("renders nothing once setup is complete, or before its state loads", () =>
	{
		const complete = renderBand(
			{
				...ELIGIBLE,
				setup:
				{
					...ELIGIBLE.setup,
					setupComplete: true,
				},
			},
		);
		const html = complete.container.innerHTML;
		const calls = complete.markSeen.mock.calls.length;
		complete.unmount();
		const loading = renderBand(null);
		expect([html, calls, loading.container.innerHTML]).toStrictEqual(["", 0, ""]);
	});
});
