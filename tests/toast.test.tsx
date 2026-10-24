// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastProvider} from "../src/components/toast";
import {useToast, type ToastOptions} from "../src/components/toast-context";

function Trigger({options}: {options: ToastOptions}) {
	const toast = useToast();
	return (
		<button
			type="button"
			onClick={() => {
				toast(options);
			}}
		>
			fire
		</button>
	);
}

function renderWithToast(options: ToastOptions) {
	render(
		<ToastProvider>
			<Trigger options={options} />
		</ToastProvider>,
	);
	fireEvent.click(screen.getByRole("button", {name: "fire"}));
}

function toastTexts(role: "status" | "alert"): string[] {
	return Array.from(screen.getByRole(role).querySelectorAll("[data-toast]")).map(
		(el) => el.querySelector("[data-toast-message]")?.textContent ?? "",
	);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("ToastProvider", () => {
	it("renders a success toast in the polite live region", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const polite = screen.getByRole("status");
		expect(polite.getAttribute("aria-live")).toBe("polite");
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);
		expect(toastTexts("alert")).toEqual([]);
	});

	it("renders error toasts in the assertive live region", () => {
		renderWithToast({message: "Couldn’t save the new name. Try again.", kind: "error"});

		const assertive = screen.getByRole("alert");
		expect(assertive.getAttribute("aria-live")).toBe("assertive");
		expect(toastTexts("alert")).toEqual(["Couldn’t save the new name. Try again."]);
		expect(toastTexts("status")).toEqual([]);
	});

	it("auto-dismisses after the default 4 seconds", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		act(() => {
			vi.advanceTimersByTime(3999);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("keeps a toast with no duration up until its signal aborts, like upstream's timeout Infinity", () => {
		const controller = new AbortController();
		renderWithToast({message: "Rewinding…", kind: "success", durationMs: null, signal: controller.signal});

		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		const held = toastTexts("status");
		act(() => {
			controller.abort();
		});

		expect({held, after: toastTexts("status")}).toStrictEqual({held: ["Rewinding…"], after: []});
	});

	it("drops a toast whose signal already aborted", () => {
		renderWithToast({message: "Rewinding…", kind: "success", signal: AbortSignal.abort()});

		expect(toastTexts("status")).toStrictEqual([]);
	});

	it("honors a custom duration", () => {
		renderWithToast({message: "Archived 3 sessions", kind: "success", durationMs: 3000});

		act(() => {
			vi.advanceTimersByTime(2999);
		});
		expect(toastTexts("status")).toEqual(["Archived 3 sessions"]);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("pauses the timer while hovered and resumes with the remaining time", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		act(() => {
			vi.advanceTimersByTime(3000);
		});

		const toastEl = screen.getByRole("status").querySelector("[data-toast]");
		if (!toastEl) throw new Error("toast not rendered");
		fireEvent.mouseEnter(toastEl);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		fireEvent.mouseLeave(toastEl);
		act(() => {
			vi.advanceTimersByTime(999);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("pauses the timer while focus is inside the toast", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const dismiss = screen.getByRole("button", {name: "Dismiss"});
		fireEvent.focus(dismiss);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		fireEvent.blur(dismiss);
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("runs the action once and closes the toast", () => {
		const onAction = vi.fn<() => void>();
		renderWithToast({
			message: "Archived 1 session",
			kind: "success",
			action: {label: "Undo", onAction},
		});

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));

		expect(onAction).toHaveBeenCalledTimes(1);
		expect(toastTexts("status")).toEqual([]);
		expect(screen.queryByRole("button", {name: "Undo"})).toBeNull();
	});

	it("closes the toast from the dismiss button without running the action", () => {
		const onAction = vi.fn<() => void>();
		renderWithToast({
			message: "Unpinned Fix login",
			kind: "success",
			action: {label: "Undo", onAction},
		});

		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));

		expect(onAction).not.toHaveBeenCalled();
		expect(toastTexts("status")).toEqual([]);
	});

	it("keeps distinct toasts in firing order", () => {
		const fire = renderTriggers([
			{message: "Link copied to clipboard.", kind: "success"},
			{message: "Archived 1 session", kind: "success"},
		]);
		fire(0);
		fire(1);

		expect(toastTexts("status")).toEqual(["Link copied to clipboard.", "Archived 1 session"]);
	});

	it("anchors both live regions bottom-right", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		expect(screen.getByRole("status").closest("[data-position]")?.getAttribute("data-position")).toBe(
			"bottom-right",
		);
		expect(screen.getByRole("alert").closest("[data-position]")?.getAttribute("data-position")).toBe(
			"bottom-right",
		);
	});

	it("renders an info icon before the message on a borderless card", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const toastEl = screen.getByRole("status").querySelector("[data-toast]");
		if (!toastEl) throw new Error("toast not rendered");
		const icon = toastEl.querySelector("[data-toast-icon]");
		const message = toastEl.querySelector("[data-toast-message]");
		if (!icon || !message) throw new Error("toast icon or message missing");
		expect({
			icon: icon.getAttribute("data-toast-icon"),
			iconBeforeMessage: Boolean(icon.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING),
			borderClasses: toastEl.className.split(/\s+/).filter((c) => /^border(-|$)/.test(c)),
		}).toEqual({icon: "info", iconBeforeMessage: true, borderClasses: []});
	});

	it("renders upstream's WarningCircle danger icon for error toasts", () => {
		renderWithToast({message: "Couldn’t save the new name. Try again.", kind: "error"});

		const icon = screen.getByRole("alert").querySelector("[data-toast-icon]");
		expect(icon?.getAttribute("data-toast-icon")).toBe("danger");
	});

	it("throws when useToast is called outside a provider", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<Trigger options={{message: "x", kind: "success"}} />)).toThrow(
			"useToast must be used within a ToastProvider",
		);
	});
});

function MultiTrigger({batches}: {batches: ToastOptions[]}) {
	const toast = useToast();
	return (
		<>
			{batches.map((options, index) => (
				<button
					key={index}
					type="button"
					onClick={() => {
						toast(options);
					}}
				>
					{`fire ${index}`}
				</button>
			))}
		</>
	);
}

function renderTriggers(batches: ToastOptions[]) {
	render(
		<ToastProvider>
			<MultiTrigger batches={batches} />
		</ToastProvider>,
	);
	return (index: number) => {
		fireEvent.click(screen.getByRole("button", {name: `fire ${index}`}));
	};
}

function deck() {
	return [...document.querySelectorAll<HTMLElement>("[data-toast]")]
		.map((element) => ({
			message: element.querySelector("[data-toast-message]")?.textContent,
			transform: element.style.transform,
			behind: element.hasAttribute("data-behind"),
		}))
		.toSorted((a, b) => Number(a.behind) - Number(b.behind));
}

describe("ToastProvider deck", () => {
	it("stacks toasts as upstream's deck: each older one 14px up and 4% smaller, its content hidden behind the front", () => {
		const fire = renderTriggers([
			{message: "First", kind: "success"},
			{message: "Second", kind: "error"},
		]);
		fire(0);
		fire(1);

		expect(deck()).toStrictEqual([
			{message: "Second", transform: "translateY(0px) scale(1)", behind: false},
			{message: "First", transform: "translateY(-14px) scale(0.96)", behind: true},
		]);
	});

	it("tints danger and warning toasts with a ring, their ink and upstream's WarningCircle / Warning icons", () => {
		const fire = renderTriggers([
			{message: "Broke", kind: "error"},
			{message: "Careful", kind: "warning"},
		]);
		fire(0);
		fire(1);
		const variant = (message: string) => {
			const toast = screen.getByText(message).closest<HTMLElement>("[data-toast]");
			return {
				kind: toast?.getAttribute("data-kind"),
				icon: toast?.querySelector("[data-toast-icon]")?.getAttribute("data-toast-icon"),
				tinted: toast?.className.includes("color-mix") ?? false,
			};
		};
		expect([variant("Broke"), variant("Careful")]).toStrictEqual([
			{kind: "error", icon: "danger", tinted: true},
			{kind: "warning", icon: "warning", tinted: true},
		]);
	});

	it("keeps error and warning toasts for 10 seconds", () => {
		renderWithToast({message: "Couldn’t save.", kind: "error"});
		act(() => {
			vi.advanceTimersByTime(9999);
		});
		expect(toastTexts("alert")).toEqual(["Couldn’t save."]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("alert")).toEqual([]);
	});

	it("keeps a toast with an action until it is used or dismissed", () => {
		renderWithToast({message: "Archived 1 session", kind: "success", action: {label: "Undo", onAction: () => {}}});
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(toastTexts("status")).toEqual(["Archived 1 session"]);
	});

	it("folds a repeat into the open toast as (×2), keeping it at least 6 more seconds", () => {
		const fire = renderTriggers([{message: "Link copied", kind: "success"}]);
		fire(0);
		act(() => {
			vi.advanceTimersByTime(3500);
		});
		fire(0);

		expect(toastTexts("status")).toEqual(["Link copied (×2)"]);
		act(() => {
			vi.advanceTimersByTime(5999);
		});
		expect(toastTexts("status")).toEqual(["Link copied (×2)"]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});
});
