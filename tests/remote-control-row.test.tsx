// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {RemoteControlToggleRow} from "../src/components/session-rail/remote-control-row";
import {ToastProvider} from "../src/components/toast";
import {HerdrRequestError} from "../src/lib/api/herdr";
import type {RemoteControlState} from "../src/lib/session-state";

type Send = (sessionId: string, on: boolean) => Promise<void>;

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

let sessionCounter = 0;

function harness(state: RemoteControlState, send: Send, working = false) {
	sessionCounter += 1;
	const sessionId = `session-${String(sessionCounter)}`;
	const ui = (next: RemoteControlState, nextWorking = working) => (
		<ToastProvider>
			<RemoteControlToggleRow
				sessionId={sessionId}
				state={next}
				url={next === "on" ? "https://claude.ai/code/session_x" : null}
				working={nextWorking}
				send={send}
			/>
		</ToastProvider>
	);
	const view = render(ui(state));
	return {
		sessionId,
		rerender: (next: RemoteControlState, nextWorking?: boolean) => {
			view.rerender(ui(next, nextWorking));
		},
	};
}

function snapshot() {
	const control = screen.getByRole("switch");
	return {
		checked: control.getAttribute("aria-checked"),
		disabled: control.hasAttribute("data-disabled"),
		spinner: document.querySelector("[data-rail-remote-control] [role=status] [data-spinner]") !== null,
		toast: document.querySelector("[data-toast-message]")?.textContent ?? null,
	};
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

describe("RemoteControlToggleRow", () => {
	it("sends /remote-control once to turn it on, then connects with a spinner over a checked, disabled switch", async () => {
		const send = vi.fn<Send>(async () => Promise.resolve());
		const {sessionId} = harness("off", send);

		fireEvent.click(screen.getByText("Remote Control"));
		fireEvent.click(screen.getByText("Remote Control"));
		await flush();

		expect({calls: send.mock.calls, row: snapshot()}).toStrictEqual({
			calls: [[sessionId, true]],
			row: {checked: "true", disabled: true, spinner: true, toast: null},
		});
	});

	it("clears the connecting state and toasts once the bridge turns on", async () => {
		const send = vi.fn<Send>(async () => Promise.resolve());
		const {rerender} = harness("off", send);
		fireEvent.click(screen.getByRole("switch"));
		await flush();

		rerender("on");

		expect(snapshot()).toStrictEqual({
			checked: "true",
			disabled: false,
			spinner: false,
			toast: "Remote Control turned on.",
		});
	});

	it("turns it off, staying checked and disabled with no spinner until the bridge drops", async () => {
		const send = vi.fn<Send>(async () => Promise.resolve());
		const {sessionId, rerender} = harness("on", send);
		fireEvent.click(screen.getByRole("switch"));
		await flush();
		const busy = snapshot();

		rerender("off");

		expect({calls: send.mock.calls, busy, done: snapshot()}).toStrictEqual({
			calls: [[sessionId, false]],
			busy: {checked: "true", disabled: true, spinner: false, toast: null},
			done: {checked: "false", disabled: false, spinner: false, toast: "Remote Control turned off."},
		});
	});

	it("toasts the generic error and resets when the send fails", async () => {
		const send = vi.fn<Send>(async () => Promise.reject(new Error("socket closed")));
		harness("off", send);
		fireEvent.click(screen.getByRole("switch"));
		await flush();

		expect(snapshot()).toStrictEqual({
			checked: "false",
			disabled: false,
			spinner: false,
			toast: "Couldn’t toggle Remote Control. Try again.",
		});
	});

	it("warns with the server's reason when it refuses to type", async () => {
		const send = vi.fn<Send>(async () =>
			Promise.reject(
				new HerdrRequestError("Clear the terminal’s input before changing Remote Control", 409, undefined),
			),
		);
		harness("on", send);
		fireEvent.click(screen.getByRole("switch"));
		await flush();

		expect(snapshot()).toStrictEqual({
			checked: "true",
			disabled: false,
			spinner: false,
			toast: "Clear the terminal’s input before changing Remote Control",
		});
	});

	it("disables the switch while Claude is working", () => {
		const send = vi.fn<Send>(async () => Promise.resolve());
		harness("off", send, true);
		fireEvent.click(screen.getByRole("switch"));

		expect({calls: send.mock.calls, row: snapshot()}).toStrictEqual({
			calls: [],
			row: {checked: "false", disabled: true, spinner: false, toast: null},
		});
	});

	it("gives up connecting after 15 s without a toast", async () => {
		vi.useFakeTimers();
		const send = vi.fn<Send>(async () => Promise.resolve());
		harness("off", send);
		fireEvent.click(screen.getByRole("switch"));
		await flush();
		const connecting = snapshot();

		act(() => {
			vi.advanceTimersByTime(15_000);
		});

		expect({connecting, after: snapshot()}).toStrictEqual({
			connecting: {checked: "true", disabled: true, spinner: true, toast: null},
			after: {checked: "false", disabled: false, spinner: false, toast: null},
		});
	});
});
