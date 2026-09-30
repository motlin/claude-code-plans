// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastProvider, useToast, type ToastOptions} from "../src/components/toast";

function Trigger({options}: {options: ToastOptions}) {
	const toast = useToast();
	return (
		<button type="button" onClick={() => toast(options)}>
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

		act(() => vi.advanceTimersByTime(3999));
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		act(() => vi.advanceTimersByTime(1));
		expect(toastTexts("status")).toEqual([]);
	});

	it("honors a custom duration", () => {
		renderWithToast({message: "Archived 3 sessions", kind: "success", durationMs: 3000});

		act(() => vi.advanceTimersByTime(2999));
		expect(toastTexts("status")).toEqual(["Archived 3 sessions"]);

		act(() => vi.advanceTimersByTime(1));
		expect(toastTexts("status")).toEqual([]);
	});

	it("pauses the timer while hovered and resumes with the remaining time", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		act(() => vi.advanceTimersByTime(3000));

		const toastEl = screen.getByRole("status").querySelector("[data-toast]");
		if (!toastEl) throw new Error("toast not rendered");
		fireEvent.mouseEnter(toastEl);
		act(() => vi.advanceTimersByTime(10_000));
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		fireEvent.mouseLeave(toastEl);
		act(() => vi.advanceTimersByTime(999));
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);
		act(() => vi.advanceTimersByTime(1));
		expect(toastTexts("status")).toEqual([]);
	});

	it("pauses the timer while focus is inside the toast", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const dismiss = screen.getByRole("button", {name: "Dismiss"});
		fireEvent.focus(dismiss);
		act(() => vi.advanceTimersByTime(10_000));
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		fireEvent.blur(dismiss);
		act(() => vi.advanceTimersByTime(4000));
		expect(toastTexts("status")).toEqual([]);
	});

	it("runs the action once and closes the toast", () => {
		const onAction = vi.fn();
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
		const onAction = vi.fn();
		renderWithToast({
			message: "Unpinned Fix login",
			kind: "success",
			action: {label: "Undo", onAction},
		});

		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));

		expect(onAction).not.toHaveBeenCalled();
		expect(toastTexts("status")).toEqual([]);
	});

	it("stacks multiple toasts in order", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		fireEvent.click(screen.getByRole("button", {name: "fire"}));

		expect(toastTexts("status")).toEqual(["Link copied to clipboard.", "Link copied to clipboard."]);
	});

	it("throws when useToast is called outside a provider", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<Trigger options={{message: "x", kind: "success"}} />)).toThrow(
			"useToast must be used within a ToastProvider",
		);
	});
});
