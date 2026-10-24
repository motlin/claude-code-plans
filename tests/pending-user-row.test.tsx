// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {HeldUserRow, SendingUserRow} from "../src/components/pending-user-row";

afterEach(() => {
	cleanup();
});

describe("SendingUserRow", () => {
	it("draws upstream's sending row: dimmed user row, the prompt bubble and a Sending… status", () => {
		const {container} = render(<SendingUserRow prompt="Fix Alice's test" />);
		const row = container.querySelector("[data-delivery-status]");
		const status = container.querySelector("[role=status]");
		expect({
			delivery: row?.getAttribute("data-delivery-status"),
			rowClass: row?.className,
			perfPrompt: container.querySelector("[data-perf-pending-prompt]") !== null,
			bubble: container.querySelector(".user-message-bubble")?.textContent,
			statusLine: status?.parentElement?.className,
			status: status?.textContent,
			statusClass: status?.className,
		}).toStrictEqual({
			delivery: "sending",
			rowClass:
				"group/msg flex w-full justify-end opacity-60 transition-opacity duration-200 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none",
			perfPrompt: true,
			bubble: "Fix Alice's test",
			statusLine: "-mt-[8px] flex items-center gap-[3px]",
			status: "Sending…",
			statusClass: "flex items-center gap-[3px] text-[12px] leading-none text-secondary",
		});
	});
});

describe("HeldUserRow", () => {
	it("draws upstream's held-for-host footer under the prompt bubble with a Withdraw X", () => {
		const onWithdraw = vi.fn<() => void>();
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting={false} onWithdraw={onWithdraw} />);
		const footer = screen.getByTestId("epitaxy-held-for-host");
		const withdraw = screen.getByRole("button", {name: "Withdraw message"});
		const mouseDown = fireEvent.mouseDown(withdraw);
		fireEvent.click(withdraw);
		expect({
			bubble: document.querySelector(".user-message-bubble")?.textContent,
			perfPrompt: document.querySelector("[data-perf-pending-prompt]") !== null,
			footerClass: footer.className,
			status: footer.querySelector("span")?.textContent,
			statusClass: footer.querySelector("span")?.className,
			withdrawClass: withdraw.className,
			focusKept: !mouseDown,
			withdrawn: onWithdraw.mock.calls.length,
		}).toStrictEqual({
			bubble: "Fix Alice's test",
			perfPrompt: true,
			footerClass: "flex items-center gap-[3px] pt-[4px]",
			status: "Waiting to deliver to the terminal…",
			statusClass: "text-[12px] leading-[15px] text-ink-muted",
			withdrawClass:
				"inline-flex size-5 shrink-0 items-center justify-center rounded-r4 text-ink-muted hover:text-secondary",
			focusKept: true,
			withdrawn: 1,
		});
	});

	it("says the terminal is reconnecting while herdr reconnects", () => {
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting onWithdraw={() => {}} />);
		expect(screen.getByTestId("epitaxy-held-for-host").querySelector("span")?.textContent).toBe(
			"Waiting for the terminal to reconnect…",
		);
	});
});
