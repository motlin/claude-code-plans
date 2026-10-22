// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {OptimisticWaitingTurn, WaitingUserTurn} from "../src/components/waiting-user-turn";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

/** The row's toolbar controls in document order: each button's aria-label or text, plus disabled state and testid. */
function toolbarControls(row: Element) {
	const toolbar = row.querySelector("[role=toolbar]");
	return toolbar === null
		? null
		: {
				label: toolbar.getAttribute("aria-label"),
				alwaysVisible: toolbar.hasAttribute("data-always-visible"),
				buttons: [...toolbar.querySelectorAll("button")].map((button) => ({
					name: button.getAttribute("aria-label") ?? button.textContent,
					disabled: button.disabled,
					testId: button.dataset["testid"] ?? null,
					inRevealGroup: button.closest("[data-reveal-on-hover]") !== null,
				})),
			};
}

describe("WaitingUserTurn", () => {
	it("draws upstream's waiting row: heading, unread status, bubble and an always-visible toolbar", () => {
		const {container} = render(<WaitingUserTurn entryId="queued-1" text="hi" head onSendNow={() => {}} />);
		const row = container.querySelector("[data-take-back-entry]");
		expect(
			row === null
				? null
				: {
						entry: row.getAttribute("data-take-back-entry"),
						className: row.className,
						heading: row.querySelector("h2")?.textContent,
						status: row.querySelector("[role=status]")?.textContent,
						bubble: row.querySelector(".user-message-bubble")?.textContent,
						toolbar: toolbarControls(row),
					},
		).toStrictEqual({
			entry: "queued-1",
			className: "group/msg flex w-full justify-start items-start gap-1",
			heading: "You said: hi",
			status: "unread",
			bubble: "hi",
			toolbar: {
				label: "Message actions",
				alwaysVisible: true,
				buttons: [
					{name: "Copy", disabled: false, testId: null, inRevealGroup: true},
					{name: "Rewind to here", disabled: true, testId: null, inRevealGroup: true},
					{name: "Send now", disabled: false, testId: "awaiting-turn-send-now", inRevealGroup: false},
				],
			},
		});
	});

	it("draws Send now only on the head entry", () => {
		const {container} = render(
			<>
				<WaitingUserTurn entryId="queued-1" text="one" head />
				<WaitingUserTurn entryId="queued-2" text="two" head={false} />
			</>,
		);
		expect(
			[...container.querySelectorAll("[data-take-back-entry]")].map((row) => ({
				entry: row.getAttribute("data-take-back-entry"),
				sendNow: row.querySelectorAll("[data-testid=awaiting-turn-send-now]").length,
			})),
		).toStrictEqual([
			{entry: "queued-1", sendNow: 1},
			{entry: "queued-2", sendNow: 0},
		]);
	});

	it("leads a stacked row's toolbar with an at-rest Unread receipt, and gives the head row none", () => {
		const {container} = render(
			<>
				<WaitingUserTurn entryId="queued-1" text="one" head />
				<WaitingUserTurn entryId="queued-2" text="two" head={false} />
			</>,
		);
		expect(
			[...container.querySelectorAll("[data-take-back-entry]")].map((row) => {
				const receipt = row.querySelector("[data-testid=epitaxy-receipt-at-rest]");
				const tip = receipt?.querySelector("button");
				return receipt === null
					? {entry: row.getAttribute("data-take-back-entry"), receipt: null}
					: {
							entry: row.getAttribute("data-take-back-entry"),
							receipt: {
								leading: row.querySelector("[role=toolbar]")?.firstElementChild === receipt,
								className: receipt.className,
								label: tip?.getAttribute("aria-label"),
								tabIndex: tip?.tabIndex,
								icon: tip
									?.querySelector("svg")
									?.getAttribute("class")
									?.split(" ")
									.includes("lucide-check"),
								dim: [
									"opacity-50",
									"hover:opacity-100",
									"focus-visible:opacity-100",
									"data-[popup-open]:opacity-100",
								].every((c) => tip?.className.split(" ").includes(c)),
							},
						};
			}),
		).toStrictEqual([
			{entry: "queued-1", receipt: null},
			{
				entry: "queued-2",
				receipt: {
					leading: true,
					className:
						"text-body text-ink-muted tabular-nums flex min-h-6 items-center self-center ps-[5px] epitaxy-hint-fade-in",
					label: "Unread",
					tabIndex: 0,
					icon: true,
					dim: true,
				},
			},
		]);
	});

	it("calls the Send now handler from the head row", () => {
		const onSendNow = vi.fn<() => void>();
		const {getByTestId} = render(<WaitingUserTurn entryId="queued-1" text="hi" head onSendNow={onSendNow} />);
		fireEvent.click(getByTestId("awaiting-turn-send-now"));
		expect(onSendNow.mock.calls).toStrictEqual([[]]);
	});
});

describe("OptimisticWaitingTurn", () => {
	it("draws the in-flight herdr prompt as a head waiting row instead of a waiting-for-transcript placeholder", () => {
		const onSendNow = vi.fn<() => void>();
		const {container} = render(<OptimisticWaitingTurn prompt="ship it" error="" onSendNow={onSendNow} />);
		const row = container.querySelector("[data-take-back-entry]");
		expect({
			entry: row?.getAttribute("data-take-back-entry"),
			perf: row?.hasAttribute("data-perf-pending-prompt"),
			bubble: row?.querySelector(".user-message-bubble")?.textContent,
			sendNow: row?.querySelectorAll("[data-testid=awaiting-turn-send-now]").length,
			placeholder: container.textContent.includes("waiting for transcript"),
			readReceipt: container.querySelector('[aria-label="Read by Claude"]'),
		}).toStrictEqual({
			entry: "optimistic",
			perf: true,
			bubble: "ship it",
			sendNow: 1,
			placeholder: false,
			readReceipt: null,
		});
		const sendNow = container.querySelector("[data-testid=awaiting-turn-send-now]");
		if (sendNow !== null) fireEvent.click(sendNow);
		expect(onSendNow.mock.calls).toStrictEqual([[]]);
	});

	it("shows a failed send's error under the row and drops Send now", () => {
		const {container} = render(<OptimisticWaitingTurn prompt="ship it" error="pane gone" onSendNow={() => {}} />);
		expect({
			sendNow: container.querySelectorAll("[data-testid=awaiting-turn-send-now]").length,
			alert: container.querySelector("[role=alert]")?.textContent,
		}).toStrictEqual({sendNow: 0, alert: "pane gone"});
	});
});
