// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {QueuedMessageBar} from "../src/components/queued-message-bar";
import {clearComposerQueues, type QueuedPrompt, queuedPreview} from "../src/lib/composer-queue";

afterEach(() => {
	cleanup();
	clearComposerQueues();
});

const ALICE: QueuedPrompt = {id: "q1", text: "Alice's first\n\n  follow-up"};
const BOB: QueuedPrompt = {id: "q2", text: "Bob's second follow-up"};

function renderBar(items: readonly QueuedPrompt[], sessionId = "session-alice") {
	const handlers = {
		onEdit: vi.fn<(item: QueuedPrompt) => void>(),
		onSendNow: vi.fn<(id: string) => Promise<void>>(async () => {}),
		onRemove: vi.fn<(id: string) => void>(),
		onClearAll: vi.fn<() => void>(),
	};
	const view = render(<QueuedMessageBar sessionId={sessionId} items={items} {...handlers} />);
	return {...handlers, ...view};
}

function buttonNames(element: HTMLElement): string[] {
	return within(element)
		.getAllByRole("button")
		.map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("queuedPreview", () => {
	it("collapses whitespace and shows an ellipsis when empty", () => {
		expect([queuedPreview(ALICE.text), queuedPreview("  \n ")]).toStrictEqual(["Alice's first follow-up", "…"]);
	});
});

describe("QueuedMessageBar", () => {
	it("renders nothing without queued prompts", () => {
		const {container} = renderBar([]);
		expect(container.innerHTML).toBe("");
	});

	it("shows one entry as a band with the count, preview and three inline buttons", () => {
		renderBar([ALICE]);
		const entry = document.querySelector<HTMLElement>("[data-take-back-entry]");
		if (entry === null) throw new Error("Expected the single-entry band");

		expect({
			className: entry.className,
			text: Array.from(entry.querySelectorAll("span")).map((span) => span.textContent),
			buttons: buttonNames(entry),
		}).toStrictEqual({
			className: "flex items-center gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 px-3 select-none",
			text: ["1 message queued", "Alice's first follow-up", "Stops Claude’s current response."],
			buttons: ["Send now", "Edit in composer", "Remove from queue"],
		});
	});

	it("describes Send now as stopping Claude's current response", () => {
		renderBar([ALICE]);
		const sendNow = screen.getByRole("button", {name: "Send now"});
		const describedBy = sendNow.getAttribute("aria-describedby");
		expect(describedBy === null ? null : document.getElementById(describedBy)?.textContent).toBe(
			"Stops Claude’s current response.",
		);
	});

	it("wires the single entry's buttons to the entry", () => {
		const {onEdit, onSendNow, onRemove} = renderBar([ALICE]);
		fireEvent.click(screen.getByRole("button", {name: "Send now"}));
		fireEvent.click(screen.getByRole("button", {name: "Edit in composer"}));
		fireEvent.click(screen.getByRole("button", {name: "Remove from queue"}));
		expect({
			sendNow: onSendNow.mock.calls,
			edit: onEdit.mock.calls,
			remove: onRemove.mock.calls,
		}).toStrictEqual({sendNow: [["q1"]], edit: [[ALICE]], remove: [["q1"]]});
	});

	it("shows Send now as busy with a 12px spinner and sr-only Sending… until the interrupt settles", async () => {
		let settle = () => {};
		const pending = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const {onSendNow} = renderBar([ALICE]);
		onSendNow.mockReturnValueOnce(pending);
		const sendNow = screen.getByRole("button", {name: "Send now"});
		fireEvent.click(sendNow);
		fireEvent.click(sendNow);
		const status = await screen.findByText("Sending…");
		const busy = {
			ariaBusy: sendNow.getAttribute("aria-busy"),
			ariaDisabled: sendNow.getAttribute("aria-disabled"),
			iconClass: sendNow.querySelector("svg")?.getAttribute("class"),
			overlayClass: sendNow.querySelector("[role=status]")?.parentElement?.className,
			spinnerBox: sendNow.querySelector<HTMLElement>("[data-spinner]")?.style.width,
			statusClass: status.className,
			calls: onSendNow.mock.calls,
		};
		await act(async () => {
			settle();
			await pending;
		});

		expect({
			busy,
			after: {
				ariaBusy: sendNow.getAttribute("aria-busy"),
				ariaDisabled: sendNow.getAttribute("aria-disabled"),
				spinner: sendNow.querySelector("[data-spinner]"),
			},
		}).toStrictEqual({
			busy: {
				ariaBusy: "true",
				ariaDisabled: "true",
				iconClass: "lucide lucide-corner-down-left size-4 opacity-0",
				overlayClass: "absolute inset-0 grid place-items-center leading-[0]",
				spinnerBox: "0.75rem",
				statusClass: "sr-only",
				calls: [["q1"]],
			},
			after: {ariaBusy: null, ariaDisabled: null, spinner: null},
		});
	});

	it("collapses two entries into a bar with the count and the next preview", () => {
		renderBar([ALICE, BOB]);
		const bar = screen.getByRole("button", {name: /2 messages queued/});
		expect({
			expanded: bar.getAttribute("aria-expanded"),
			text: Array.from(bar.querySelectorAll(":scope > span")).map((span) => span.textContent),
			list: screen.queryByRole("list", {name: "Queued messages"}),
		}).toStrictEqual({
			expanded: "false",
			text: ["2 messages queued", "Next: Alice's first follow-up", ""],
			list: null,
		});
	});

	it("expands to a list of rows with Clear all, and collapsing returns focus to the bar", () => {
		const {onClearAll} = renderBar([ALICE, BOB]);
		const bar = screen.getByRole("button", {name: /2 messages queued/});
		bar.focus();
		fireEvent.click(bar);

		const list = screen.getByRole("list", {name: "Queued messages"});
		const collapse = screen.getByRole("button", {name: "Collapse queued messages"});
		const focusAfterExpand = document.activeElement;
		fireEvent.click(screen.getByRole("button", {name: "Clear all"}));
		collapse.focus();
		fireEvent.click(collapse);

		expect({
			rows: within(list)
				.getAllByRole("listitem")
				.map((row) => row.querySelector(".line-clamp-2")?.textContent),
			collapseExpanded: collapse.getAttribute("aria-expanded"),
			focusAfterExpand: focusAfterExpand === collapse,
			clearAll: onClearAll.mock.calls,
			focusAfterCollapse: document.activeElement?.getAttribute("aria-expanded"),
			list: screen.queryByRole("list", {name: "Queued messages"}),
		}).toStrictEqual({
			rows: [ALICE.text, BOB.text],
			collapseExpanded: "true",
			focusAfterExpand: true,
			clearAll: [[]],
			focusAfterCollapse: "false",
			list: null,
		});
	});

	it("offers Edit in composer / Send now / Remove from queue in each row's menu", async () => {
		const {onSendNow} = renderBar([ALICE, BOB]);
		fireEvent.click(screen.getByRole("button", {name: /2 messages queued/}));
		const triggers = screen.getAllByRole("button", {name: "Queued message actions"});
		const second = triggers[1];
		if (second === undefined) throw new Error("Expected two row menus");
		fireEvent.click(second);
		const menu = await screen.findByRole("menu");
		const items = within(menu)
			.getAllByRole("menuitem")
			.map((item) => item.textContent);
		fireEvent.click(within(menu).getByRole("menuitem", {name: "Send now"}));

		expect({
			items,
			separators: within(menu).getAllByRole("separator").length,
			sent: onSendNow.mock.calls,
		}).toStrictEqual({
			items: ["Edit in composer", "Send now", "Remove from queue"],
			separators: 1,
			sent: [["q2"]],
		});
	});

	it("remembers expansion per session across remounts", () => {
		const first = renderBar([ALICE, BOB]);
		fireEvent.click(screen.getByRole("button", {name: /2 messages queued/}));
		first.unmount();
		renderBar([ALICE, BOB]);
		expect(screen.getByRole("list", {name: "Queued messages"})).toBeTruthy();
	});

	it("plays the exit animation when the last entry leaves, then unmounts", () => {
		const view = renderBar([ALICE]);
		view.rerender(
			<QueuedMessageBar
				sessionId="session-alice"
				items={[]}
				onEdit={view.onEdit}
				onSendNow={view.onSendNow}
				onRemove={view.onRemove}
				onClearAll={view.onClearAll}
			/>,
		);
		const leaving = view.container.firstElementChild;
		const exiting = {
			className: leaving?.className,
			inert: leaving?.hasAttribute("inert"),
			text: leaving?.querySelector("[data-take-back-entry] span")?.textContent,
		};
		// jsdom has no AnimationEvent, so React listens for the prefixed name instead of `animationend`.
		if (leaving) fireEvent(leaving, new Event("webkitAnimationEnd", {bubbles: true}));

		expect({exiting, after: view.container.innerHTML}).toStrictEqual({
			exiting: {className: "band-enter band-exit", inert: true, text: "1 message queued"},
			after: "",
		});
	});
});
