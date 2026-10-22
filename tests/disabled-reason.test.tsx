// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {DisabledReason} from "../src/components/ui/disabled-reason";

const REASON = "Choose an option or skip this question";

const WRAPPER_CLASS =
	"inline-flex rounded-r5 outline-none hide-focus-ring transition-shadow duration-[60ms] focus-visible:shadow-focus";

afterEach(() => {
	cleanup();
});

function wrapperOf(container: HTMLElement): HTMLElement {
	const wrapper = container.querySelector<HTMLElement>("[data-cds-disabled-reason-wrapper]");
	if (wrapper === null) throw new Error("no disabled-reason wrapper");
	return wrapper;
}

/** The text `aria-describedby` points at, joined like an accessible description. */
function descriptionOf(element: HTMLElement): string {
	return (element.getAttribute("aria-describedby") ?? "")
		.split(" ")
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? "")
		.join(" ");
}

function control(disabled: boolean) {
	return (
		<button type="button" disabled={disabled}>
			Next
		</button>
	);
}

describe("<DisabledReason>", () => {
	it("makes the wrapper a tab stop described by a hidden reason span", () => {
		const {container} = render(<DisabledReason reason={REASON}>{control(true)}</DisabledReason>);

		const wrapper = wrapperOf(container);
		const reason = wrapper.querySelector<HTMLElement>("[data-cds-disabled-reason]");
		expect({
			tabIndex: wrapper.tabIndex,
			className: wrapper.className,
			describedBy: wrapper.getAttribute("aria-describedby"),
			reasonId: reason?.id,
			reasonHidden: reason?.hidden,
			reasonText: reason?.textContent,
			lastChild: wrapper.lastElementChild === reason,
		}).toStrictEqual({
			tabIndex: 0,
			className: WRAPPER_CLASS,
			describedBy: reason?.id,
			reasonId: reason?.id,
			reasonHidden: true,
			reasonText: REASON,
			lastChild: true,
		});
	});

	it("keeps the same wrapper with no tab stop, description or reason span while there is no reason", () => {
		const {container, rerender} = render(<DisabledReason reason={REASON}>{control(true)}</DisabledReason>);
		const before = wrapperOf(container);
		const button = screen.getByRole("button");

		rerender(<DisabledReason reason={null}>{control(false)}</DisabledReason>);

		const after = wrapperOf(container);
		expect({
			sameWrapper: after === before,
			sameButton: screen.getByRole("button") === button,
			tabIndex: after.tabIndex,
			describedBy: after.getAttribute("aria-describedby"),
			reasonSpan: after.querySelector("[data-cds-disabled-reason]"),
		}).toStrictEqual({sameWrapper: true, sameButton: true, tabIndex: -1, describedBy: null, reasonSpan: null});
	});

	it("opens the reason tooltip at once when the wrapper takes focus", () => {
		const {container} = render(<DisabledReason reason={REASON}>{control(true)}</DisabledReason>);

		act(() => {
			wrapperOf(container).focus();
		});

		expect(screen.getByRole("tooltip").textContent).toBe(REASON);
	});

	it("keeps the reason tooltip open when the wrapper is clicked", () => {
		const {container} = render(<DisabledReason reason={REASON}>{control(true)}</DisabledReason>);
		const wrapper = wrapperOf(container);
		act(() => {
			wrapper.focus();
		});

		fireEvent.click(wrapper);

		expect(screen.getByRole("tooltip").textContent).toBe(REASON);
	});

	it("uses upstream's balanced 240px reason box", () => {
		const {container} = render(<DisabledReason reason={REASON}>{control(true)}</DisabledReason>);
		act(() => {
			wrapperOf(container).focus();
		});

		expect(screen.getByRole("tooltip").className).toBe(
			"pointer-events-none absolute z-50 flex w-max max-w-[240px] flex-col gap-0.5 whitespace-normal text-balance rounded-r5 bg-[var(--tooltip-bg)] px-2 py-1.5 text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-1/2 mb-1 -translate-x-1/2",
		);
	});

	it("describes the wrapper, not the button, even while the tooltip is open", () => {
		const {container} = render(<DisabledReason reason={REASON}>{control(true)}</DisabledReason>);
		const wrapper = wrapperOf(container);
		const closed = descriptionOf(wrapper);
		act(() => {
			wrapper.focus();
		});

		expect({
			closed,
			open: descriptionOf(wrapper),
			buttonDescribedBy: screen.getByRole("button").getAttribute("aria-describedby"),
		}).toStrictEqual({closed: REASON, open: REASON, buttonDescribedBy: null});
	});

	it("never opens a tooltip without a reason", () => {
		const {container} = render(<DisabledReason reason={undefined}>{control(false)}</DisabledReason>);

		fireEvent.focus(wrapperOf(container));

		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});
