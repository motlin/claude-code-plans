// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {
	HeldSteerTurns,
	OptimisticWaitingTurn,
	WaitingPickupStatus,
	WaitingUserTurn,
} from "../src/components/waiting-user-turn";

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

describe("HeldSteerTurns", () => {
	const STEERS = [
		{id: "q4", text: "Dave's answer instead", midTurn: true as const},
		{id: "q5", text: "and Erin's too", midTurn: true as const},
	];

	it("draws browser-held steers as waiting rows, Send now on the head only", () => {
		const {container} = render(
			<HeldSteerTurns items={STEERS} head onSendNow={async () => {}} onCancel={() => {}} />,
		);
		expect(
			[...container.querySelectorAll("[data-take-back-entry]")].map((row) => ({
				entry: row.getAttribute("data-take-back-entry"),
				bubble: row.querySelector(".user-message-bubble")?.textContent,
				status: row.querySelector("[role=status]")?.textContent,
				sendNow: row.querySelectorAll("[data-testid=awaiting-turn-send-now]").length,
				unread: row.querySelectorAll('[aria-label="Unread"]').length,
			})),
		).toStrictEqual([
			{entry: "q4", bubble: "Dave's answer instead", status: "unread", sendNow: 1, unread: 0},
			{entry: "q5", bubble: "and Erin's too", status: "unread", sendNow: 0, unread: 1},
		]);
	});

	it("stacks every held steer behind an earlier waiting row", () => {
		const {container} = render(
			<HeldSteerTurns items={STEERS} head={false} onSendNow={async () => {}} onCancel={() => {}} />,
		);
		expect({
			sendNow: container.querySelectorAll("[data-testid=awaiting-turn-send-now]").length,
			unread: container.querySelectorAll('[aria-label="Unread"]').length,
		}).toStrictEqual({sendNow: 0, unread: 2});
	});

	it("Send now forwards the head steer's id", () => {
		const onSendNow = vi.fn<(id: string) => Promise<void>>(async () => {});
		const {container} = render(<HeldSteerTurns items={STEERS} head onSendNow={onSendNow} onCancel={() => {}} />);
		const sendNow = container.querySelector("[data-testid=awaiting-turn-send-now]");
		if (sendNow !== null) fireEvent.click(sendNow);
		expect(onSendNow.mock.calls).toStrictEqual([["q4"]]);
	});

	it("Cancel and edit forwards the steer it was clicked on", () => {
		const onCancel = vi.fn<(item: {id: string; text: string}) => void>();
		const {getAllByRole} = render(
			<HeldSteerTurns items={STEERS} head onSendNow={async () => {}} onCancel={onCancel} />,
		);
		const [, second] = getAllByRole("button", {name: "Cancel and edit message"});
		if (second !== undefined) fireEvent.click(second);
		expect(onCancel.mock.calls).toStrictEqual([[{id: "q5", text: "and Erin's too", midTurn: true}]]);
	});

	it("renders nothing without held steers", () => {
		const {container} = render(<HeldSteerTurns items={[]} head onSendNow={async () => {}} onCancel={() => {}} />);
		expect(container.innerHTML).toBe("");
	});
});

describe("waiting-row sr announcements", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("announces unread while waiting, then read for 1400ms after pickup, then nothing", () => {
		vi.useFakeTimers();
		const {container, rerender} = render(<WaitingUserTurn entryId="queued-1" text="hi" head={false} />);
		const status = () => container.querySelector("[role=status]")?.textContent;
		const waiting = status();
		rerender(<WaitingUserTurn entryId="queued-1" text="hi" head={false} delivered />);
		const picked = status();
		act(() => {
			vi.advanceTimersByTime(1399);
		});
		const before = status();
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect({waiting, picked, before, after: status()}).toStrictEqual({
			waiting: "unread",
			picked: "read",
			before: "read",
			after: "",
		});
	});

	it("announces read for 1400ms when a waiting prompt leaves the live session's queue", () => {
		vi.useFakeTimers();
		const {container, rerender} = render(<WaitingPickupStatus waitingIds={["queued-1", "queued-2"]} />);
		const status = () => {
			const node = container.querySelector("[role=status]");
			return node === null ? null : {className: node.className, text: node.textContent};
		};
		const waiting = status();
		rerender(<WaitingPickupStatus waitingIds={["queued-2"]} />);
		const picked = status();
		act(() => {
			vi.advanceTimersByTime(1400);
		});
		expect({waiting, picked, after: status()}).toStrictEqual({
			waiting: {className: "sr-only", text: ""},
			picked: {className: "sr-only", text: "read"},
			after: {className: "sr-only", text: ""},
		});
	});
});

describe("Send now on the head waiting row", () => {
	function deferred() {
		let settle = () => {};
		const promise = new Promise<void>((resolve) => {
			settle = resolve;
		});
		return {promise, settle};
	}

	it("stays busy with a 12px spinner overlay until the interrupt settles, ignoring clicks meanwhile", async () => {
		const pending = deferred();
		const onSendNow = vi.fn<() => Promise<void>>(async () => pending.promise);
		const {getByTestId, findByText} = render(
			<WaitingUserTurn entryId="queued-1" text="hi" head onSendNow={onSendNow} />,
		);
		const sendNow = getByTestId("awaiting-turn-send-now");
		fireEvent.click(sendNow);
		fireEvent.click(sendNow);
		const status = await findByText("Sending…");
		const busy = {
			ariaBusy: sendNow.getAttribute("aria-busy"),
			ariaDisabled: sendNow.getAttribute("aria-disabled"),
			labelClass: sendNow.querySelector("[data-send-now-label]")?.className,
			overlayClass: sendNow.querySelector("[role=status]")?.parentElement?.className,
			statusClass: status.className,
			spinnerBox: sendNow.querySelector<HTMLElement>("[data-spinner]")?.style.width,
			description: document.getElementById(sendNow.getAttribute("aria-describedby") ?? "")?.textContent,
			calls: onSendNow.mock.calls.length,
		};
		await act(async () => {
			pending.settle();
			await pending.promise;
		});
		expect({
			busy,
			after: {
				ariaBusy: sendNow.getAttribute("aria-busy"),
				ariaDisabled: sendNow.getAttribute("aria-disabled"),
				labelClass: sendNow.querySelector("[data-send-now-label]")?.className,
				spinner: sendNow.querySelector("[data-spinner]"),
			},
		}).toStrictEqual({
			busy: {
				ariaBusy: "true",
				ariaDisabled: "true",
				labelClass: "opacity-0",
				overlayClass: "absolute inset-0 grid place-items-center leading-[0]",
				spinnerBox: "0.75rem",
				statusClass: "sr-only",
				description: "Stops Claude’s current response.",
				calls: 1,
			},
			after: {ariaBusy: null, ariaDisabled: null, labelClass: "", spinner: null},
		});
	});

	it("hands a mouse click's focus to the composer, but keeps a keyboard press's focus", async () => {
		const onFocusComposer = vi.fn<() => void>();
		const {getByTestId} = render(
			<WaitingUserTurn
				entryId="queued-1"
				text="hi"
				head
				onSendNow={async () => {}}
				onFocusComposer={onFocusComposer}
			/>,
		);
		const sendNow = getByTestId("awaiting-turn-send-now");
		sendNow.focus();
		fireEvent.click(sendNow, {detail: 0});
		const keyboard = {
			focusComposer: onFocusComposer.mock.calls.length,
			focused: document.activeElement === sendNow,
		};
		await act(async () => {});
		sendNow.focus();
		fireEvent.pointerDown(sendNow, {pointerType: "mouse"});
		fireEvent.click(sendNow, {detail: 1});
		await act(async () => {});
		expect({
			keyboard,
			mouse: {focusComposer: onFocusComposer.mock.calls.length, focused: document.activeElement === sendNow},
		}).toStrictEqual({
			keyboard: {focusComposer: 0, focused: true},
			mouse: {focusComposer: 1, focused: false},
		});
	});

	it("moves keyboard focus to the next Send now mounted within 1000ms of the focused one unmounting", () => {
		const {getByTestId, rerender} = render(
			<WaitingUserTurn key="queued-1" entryId="queued-1" text="one" head onSendNow={async () => {}} />,
		);
		// Keyboard modality, so the focused button matches :focus-visible.
		fireEvent.keyDown(document.body, {key: "Tab"});
		getByTestId("awaiting-turn-send-now").focus();
		rerender(<div />);
		const dropped = document.activeElement === document.body;
		rerender(<WaitingUserTurn key="queued-2" entryId="queued-2" text="two" head onSendNow={async () => {}} />);
		expect({dropped, handedOff: document.activeElement === getByTestId("awaiting-turn-send-now")}).toStrictEqual({
			dropped: true,
			handedOff: true,
		});
	});

	it("leaves focus alone when the next Send now mounts after 1000ms", () => {
		vi.useFakeTimers({toFake: ["performance"]});
		try {
			const {getByTestId, rerender} = render(
				<WaitingUserTurn key="queued-1" entryId="queued-1" text="one" head onSendNow={async () => {}} />,
			);
			fireEvent.keyDown(document.body, {key: "Tab"});
			getByTestId("awaiting-turn-send-now").focus();
			rerender(<div />);
			vi.advanceTimersByTime(1001);
			rerender(<WaitingUserTurn key="queued-2" entryId="queued-2" text="two" head onSendNow={async () => {}} />);
			expect(document.activeElement === document.body).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("Cancel and edit on a browser-held waiting row", () => {
	it("puts upstream's X in the hover group after Rewind, before Send now", () => {
		const {container} = render(
			<WaitingUserTurn entryId="q1" text="hi" head onSendNow={() => {}} onCancel={() => {}} />,
		);
		const row = container.querySelector("[data-take-back-entry]");
		const cancel = container.querySelector('[aria-label="Cancel and edit message"]');
		expect({
			toolbar: row === null ? null : toolbarControls(row),
			wrapper: cancel?.closest(".epitaxy-hint-fade-in")?.className,
			button: cancel?.className.split(" ").filter((name) => ["size-6", "rounded-r5"].includes(name)),
			icon: cancel?.querySelector("svg") !== null,
		}).toStrictEqual({
			toolbar: {
				label: "Message actions",
				alwaysVisible: true,
				buttons: [
					{name: "Copy", disabled: false, testId: null, inRevealGroup: true},
					{name: "Rewind to here", disabled: true, testId: null, inRevealGroup: true},
					{name: "Cancel and edit message", disabled: false, testId: null, inRevealGroup: true},
					{name: "Send now", disabled: false, testId: "awaiting-turn-send-now", inRevealGroup: false},
				],
			},
			wrapper: "epitaxy-hint-fade-in flex items-center gap-[3px]",
			button: ["size-6", "rounded-r5"],
			icon: true,
		});
	});

	it("calls the cancel handler and shows upstream's Removing… busy state until it settles", async () => {
		let settle = () => {};
		const onCancel = vi.fn<() => Promise<void>>(
			async () =>
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
		);
		const {getByRole} = render(<WaitingUserTurn entryId="q1" text="hi" head={false} onCancel={onCancel} />);
		const cancel = getByRole("button", {name: "Cancel and edit message"});
		fireEvent.click(cancel);
		fireEvent.click(cancel);
		const busy = {
			calls: onCancel.mock.calls.length,
			ariaBusy: cancel.getAttribute("aria-busy"),
			busyLabel: cancel.querySelector(".sr-only")?.textContent,
			spinner: cancel.querySelector("[data-spinner]") !== null,
		};
		await act(async () => {
			settle();
			await Promise.resolve();
		});
		expect({
			busy,
			after: {
				ariaBusy: cancel.getAttribute("aria-busy"),
				spinner: cancel.querySelector("[data-spinner]") !== null,
			},
		}).toStrictEqual({
			busy: {calls: 1, ariaBusy: "true", busyLabel: "Removing…", spinner: true},
			after: {ariaBusy: null, spinner: false},
		});
	});

	it("JSONL-backed waiting row has no cancel: the CLI owns that queue", () => {
		const {container} = render(<WaitingUserTurn entryId="line-12" text="hi" head onSendNow={() => {}} />);
		expect(container.querySelectorAll('[aria-label="Cancel and edit message"]').length).toBe(0);
	});
});
