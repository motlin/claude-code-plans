// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {FailedUserRow, HeldUserRow, SendingUserRow} from "../src/components/pending-user-row";

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("SendingUserRow", () =>
{
	it("draws upstream's sending row: dimmed user row, the prompt bubble and a Sending… status", () =>
	{
		const {container} = render(<SendingUserRow prompt="Fix Alice's test" />);
		const row = container.querySelector("[data-delivery-status]");
		const status = container.querySelector("[role=status]");
		expect(
			{
				delivery: row?.getAttribute("data-delivery-status"),
				rowClass: row?.className,
				perfPrompt: container.querySelector("[data-perf-pending-prompt]") !== null,
				bubble: container.querySelector(".user-message-bubble")?.textContent,
				statusLine: status?.parentElement?.className,
				status: status?.textContent,
				statusClass: status?.className,
			},
		).toStrictEqual(
			{
				delivery: "sending",
				rowClass:
					"group/msg flex w-full justify-end opacity-60 transition-opacity duration-200 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none",
				perfPrompt: true,
				bubble: "Fix Alice's test",
				statusLine: "-mt-[8px] flex items-center gap-[3px]",
				status: "Sending…",
				statusClass:
					"flex items-center gap-[3px] text-[12px] leading-none text-secondary comfortable:text-[13px]",
			},
		);
	});
});

describe("HeldUserRow", () =>
{
	it("draws upstream's held-for-host footer as an always-visible MessageActions toolbar with the Withdraw X at the end", () =>
	{
		const onWithdraw = vi.fn<() => void>();
		vi.spyOn(performance, "now").mockReturnValue(4500);
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting={false} onWithdraw={onWithdraw} />);
		const toolbar = screen.getByRole(
			"toolbar",
			{
				name: "Message actions",
			},
		);
		const status = screen.getByTestId("epitaxy-held-for-host");
		const withdraw = screen.getByRole(
			"button",
			{
				name: "Withdraw message",
			},
		);
		const mouseDown = fireEvent.mouseDown(withdraw);
		fireEvent.click(withdraw);
		expect(
			{
				bubble: document.querySelector(".user-message-bubble")?.textContent,
				perfPrompt: document.querySelector("[data-perf-pending-prompt]") !== null,
				toolbar:
				{
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
			},
		).toStrictEqual(
			{
				bubble: "Fix Alice's test",
				perfPrompt: true,
				toolbar:
				{
					cds: "MessageActions",
					reveal: "fade",
					alwaysVisible: "",
					size: "xs",
					tabIndex: "-1",
					className:
						"flex items-center select-none focus-visible:rounded outline-none focus-visible:outline-hidden forced-colors:focus-visible:-outline-offset-2 focus-visible:[box-shadow:inset_0_0_0_var(--cds-ring-focus-width,1px)_var(--cds-fill-accent,Highlight)]",
				},
				children: ["SPAN", "BUTTON"],
				statusFirst: true,
				withdrawLast: true,
				// Upstream keeps the muted shimmer mounted with active:false while not reconnecting.
				statusHtml:
					'<span data-testid="epitaxy-held-for-host" class="flex min-h-[20px] items-center text-[12px] leading-[15px] text-secondary pe-[4px] comfortable:min-h-[24px] comfortable:text-[13px] comfortable:leading-[17px] comfortable:pe-[6px]">' +
					'<span data-cds="ShimmerText" data-shimmering="false" data-variant="muted">Waiting to deliver to the terminal…</span>' +
					"</span>",
				withdrawClass:
					"inline-flex size-5 comfortable:size-6 shrink-0 items-center justify-center rounded-r4 comfortable:rounded-r5 text-ink-muted hover:text-primary",
				focusKept: true,
				withdrawn: 1,
			},
		);
	});

	it("sweeps a muted shimmer, phase-locked to the 3s period, over the reconnecting text while herdr reconnects", () =>
	{
		vi.spyOn(performance, "now").mockReturnValue(7250);
		render(
			<HeldUserRow
				prompt="Fix Alice's test"
				reconnecting
				onWithdraw={() =>
				{
				}}
			/>,
		);
		const shimmer = screen.getByTestId("epitaxy-held-for-host").querySelector('[data-cds="ShimmerText"]');
		expect(
			{
				shimmering: shimmer?.getAttribute("data-shimmering"),
				variant: shimmer?.getAttribute("data-variant"),
				delay: shimmer?.getAttribute("style"),
				text: shimmer?.textContent,
			},
		).toStrictEqual(
			{
				shimmering: "true",
				variant: "muted",
				// jsdom lacks glyph masks, so the shimmer runs in fallback and its delay is an animation-delay.
				delay: "animation-delay: -1250ms;",
				text: "Waiting for the terminal to reconnect…",
			},
		);
	});
});

describe("HeldUserRow roving", () =>
{
	it("makes Withdraw the toolbar's stop and keeps an arrow on it, as upstream's RC wraps a one-item bar", () =>
	{
		render(<HeldUserRow prompt="Fix Alice's test" reconnecting={false} onWithdraw={() => undefined} />);
		const withdraw = screen.getByRole(
			"button",
			{
				name: "Withdraw message",
			},
		);
		act(() =>
		{
			withdraw.focus();
		});
		const notPrevented = fireEvent.keyDown(
			withdraw,
			{
				key: "ArrowRight",
			},
		);

		expect(
			{
				tabIndex: withdraw.getAttribute("tabindex"),
				focused: document.activeElement === withdraw,
				prevented: !notPrevented,
			},
		).toStrictEqual(
			{
				tabIndex: "0",
				focused: true,
				prevented: true,
			},
		);
	});
});

describe("FailedUserRow", () =>
{
	it("draws upstream's durable Not delivered footer: danger status with the send time, then ghost Retry and Discard", () =>
	{
		const onRetry = vi.fn<() => void>();
		const onDiscard = vi.fn<() => void>();
		const {container} = render(
			<FailedUserRow prompt="Fix Alice's test" sentAt="3:42 PM" onRetry={onRetry} onDiscard={onDiscard} />,
		);
		const footer = screen.getByTestId("epitaxy-failed-send");
		const status = footer.firstElementChild;
		const retry = screen.getByRole(
			"button",
			{
				name: "Retry",
			},
		);
		const discard = screen.getByRole(
			"button",
			{
				name: "Discard",
			},
		);
		const retryDown = fireEvent.mouseDown(retry);
		const discardDown = fireEvent.mouseDown(discard);
		fireEvent.click(retry);
		fireEvent.click(discard);
		expect(
			{
				delivery: container.querySelector("[data-delivery-status]")?.getAttribute("data-delivery-status"),
				rowClass: container.querySelector("[data-delivery-status]")?.className,
				bubble: container.querySelector(".user-message-bubble")?.textContent,
				footerClass: footer.className,
				children: [...footer.children].map((child) => child.tagName),
				statusClass: status?.className,
				statusText: status?.textContent,
				icon: status?.querySelector("svg")?.getAttribute("data-cds"),
				iconSize: (status?.querySelector("svg") as SVGElement | null)?.style.fontSize,
				buttonClasses: [retry.className, discard.className],
				buttonTypes: [retry.getAttribute("type"), discard.getAttribute("type")],
				focusKept: [!retryDown, !discardDown],
				retries: onRetry.mock.calls.length,
				discards: onDiscard.mock.calls.length,
				noToolbar: container.querySelector("[role=toolbar]") === null,
			},
		).toStrictEqual(
			{
				delivery: "failed",
				rowClass: "group/msg flex w-full justify-end",
				bubble: "Fix Alice's test",
				footerClass: "flex items-center gap-1 pt-[4px]",
				children: ["SPAN", "BUTTON", "BUTTON"],
				statusClass:
					"flex items-center gap-[3px] text-[12px] leading-[15px] text-danger comfortable:text-[13px] comfortable:leading-[17px]",
				statusText: "Not delivered · 3:42 PM",
				icon: "Icon",
				iconSize: "calc(0.75rem * var(--cds-rem-scale, 1))",
				buttonClasses: [FAILED_ACTION_CLASS, FAILED_ACTION_CLASS],
				buttonTypes: ["button", "button"],
				focusKept: [true, true],
				retries: 1,
				discards: 1,
				noToolbar: true,
			},
		);
	});

	it("reads plain Not delivered with no send time", () =>
	{
		render(<FailedUserRow prompt="hi" sentAt={undefined} onRetry={() => undefined} onDiscard={() => undefined} />);
		expect(screen.getByTestId("epitaxy-failed-send").firstElementChild?.textContent).toBe("Not delivered");
	});
});

/** Upstream cds Button `variant="ghost" size="xxs"` (data-step 1: 20px high, 5px radius, 12px/17px, 0 6px). */
const FAILED_ACTION_CLASS =
	"relative inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-r4 whitespace-nowrap select-none px-1.5 font-control-regular text-[12px] leading-[17px] text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
