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
	it("draws upstream's notice band shell with a Start action and a Dismiss slot", () =>
	{
		const {container} = renderBand();
		const root = childAt(container, 0);
		const [iconSlot, body, dismissSlot] = [childAt(root, 0), childAt(root, 1), childAt(root, 2)];
		const [words, actions] = [childAt(body, 0), childAt(body, 1)];
		const wordsRow = childAt(words, 0);
		const startSlot = childAt(actions, 0);
		expect(
			{
				root: [root.getAttribute("role"), root.getAttribute("aria-live"), root.className],
				iconSlot: [iconSlot.className, childAt(iconSlot, 0).getAttribute("class")],
				body: body.className,
				words: [words.className, wordsRow.className, childAt(wordsRow, 0).className, words.textContent],
				actions: [
					actions.className,
					startSlot.className,
					childAt(startSlot, 0).getAttribute("aria-label"),
					actions.textContent,
				],
				dismiss: [dismissSlot.className, childAt(dismissSlot, 0).getAttribute("aria-label")],
			},
		).toStrictEqual(
			{
				root: [
					"status",
					"polite",
					"flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-body usage-band-enter",
				],
				iconSlot: ["flex h-[1lh] shrink-0 items-center", "lucide lucide-shield-check text-muted-as-secondary"],
				body: "flex min-w-0 flex-1 flex-wrap gap-x-[8px] gap-y-[8px] items-start",
				words: [
					"min-w-0 max-w-full flex-auto",
					"flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75",
					"min-w-0 text-primary",
					MESSAGE,
				],
				actions: [
					"flex min-w-0 max-w-full shrink-0 flex-wrap items-start gap-x-[8px] gap-y-[8px]",
					"flex h-[1lh] shrink-0 items-center",
					"Start",
					"Start",
				],
				dismiss: ["ms-1.25 flex h-[1lh] shrink-0 items-center", "Dismiss"],
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
