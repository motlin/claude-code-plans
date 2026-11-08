// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {HeldUserRow, SendingUserRow} from "../src/components/pending-user-row";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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
			statusClass: "flex items-center gap-[3px] text-[12px] leading-none text-secondary comfortable:text-[13px]",
		});
	});
});

describe("HeldUserRow", () => {
	it("draws upstream's held-for-host footer as an always-visible MessageActions toolbar with the Withdraw X at the end", () => {
		const onWithdraw = vi.fn<() => void>();
		vi.spyOn(performance, "now").mockReturnValue(4500);
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting={false} onWithdraw={onWithdraw} />);
		const toolbar = screen.getByRole("toolbar", {name: "Message actions"});
		const status = screen.getByTestId("epitaxy-held-for-host");
		const withdraw = screen.getByRole("button", {name: "Withdraw message"});
		const mouseDown = fireEvent.mouseDown(withdraw);
		fireEvent.click(withdraw);
		expect({
			bubble: document.querySelector(".user-message-bubble")?.textContent,
			perfPrompt: document.querySelector("[data-perf-pending-prompt]") !== null,
			toolbar: {
				cds: toolbar.getAttribute("data-cds"),
				reveal: toolbar.getAttribute("data-reveal"),
				alwaysVisible: toolbar.getAttribute("data-always-visible"),
				size: toolbar.getAttribute("data-size"),
				tabIndex: toolbar.getAttribute("tabindex"),
				className: toolbar.className,
			},
			children: [...toolbar.children].map((child) => child.tagName),
			statusFirst: toolbar.firstElementChild === status,
			withdrawLast: toolbar.lastElementChild === withdraw,
			statusHtml: status.outerHTML,
			withdrawClass: withdraw.className,
			focusKept: !mouseDown,
			withdrawn: onWithdraw.mock.calls.length,
		}).toStrictEqual({
			bubble: "Fix Alice's test",
			perfPrompt: true,
			toolbar: {
				cds: "MessageActions",
				reveal: "fade",
				alwaysVisible: "",
				size: "xs",
				tabIndex: "-1",
				className: "flex items-center select-none",
			},
			children: ["SPAN", "BUTTON"],
			statusFirst: true,
			withdrawLast: true,
			// Upstream keeps the muted shimmer mounted with active:false while not reconnecting.
			statusHtml:
				'<span data-testid="epitaxy-held-for-host" class="flex min-h-[20px] items-center text-[12px] leading-[15px] text-secondary pe-[4px] comfortable:min-h-[24px] comfortable:text-[13px] comfortable:leading-[17px] comfortable:pe-[6px]">' +
				'<span data-cds="ShimmerText" data-shimmering="false" dir="auto" data-variant="muted" style="--shimmer-delay: -1500ms;">Waiting to deliver to the terminal…</span>' +
				"</span>",
			withdrawClass:
				"inline-flex size-5 comfortable:size-6 shrink-0 items-center justify-center rounded-r4 comfortable:rounded-r5 text-ink-muted hover:text-primary",
			focusKept: true,
			withdrawn: 1,
		});
	});

	it("sweeps a muted shimmer, phase-locked to the 3s period, over the reconnecting text while herdr reconnects", () => {
		vi.spyOn(performance, "now").mockReturnValue(7250);
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting onWithdraw={() => {}} />);
		const shimmer = screen.getByTestId("epitaxy-held-for-host").querySelector('[data-cds="ShimmerText"]');
		expect({
			shimmering: shimmer?.getAttribute("data-shimmering"),
			variant: shimmer?.getAttribute("data-variant"),
			delay: shimmer?.getAttribute("style"),
			clone: shimmer?.querySelector("[data-cds-shimmer-clone]")?.textContent,
			text: shimmer?.firstChild?.textContent,
		}).toStrictEqual({
			shimmering: "true",
			variant: "muted",
			delay: "--shimmer-delay: -1250ms;",
			clone: "Waiting for the terminal to reconnect…",
			text: "Waiting for the terminal to reconnect…",
		});
	});
});

describe("HeldUserRow roving", () => {
	it("makes Withdraw the toolbar's stop and keeps an arrow on it, as upstream's RC wraps a one-item bar", () => {
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting={false} onWithdraw={() => undefined} />);
		const withdraw = screen.getByRole("button", {name: "Withdraw message"});
		act(() => {
			withdraw.focus();
		});
		const notPrevented = fireEvent.keyDown(withdraw, {key: "ArrowRight"});

		expect({
			tabIndex: withdraw.getAttribute("tabindex"),
			focused: document.activeElement === withdraw,
			prevented: !notPrevented,
		}).toStrictEqual({tabIndex: "0", focused: true, prevented: true});
	});
});
