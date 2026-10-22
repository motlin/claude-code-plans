// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {InfoTip} from "../src/components/ui/info-tip";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function renderTip(delay?: number) {
	return render(
		<div>
			<InfoTip
				aria-label="Read by Claude"
				content="Read by Claude"
				icon={<svg data-testid="glyph" />}
				{...(delay === undefined ? {} : {delay})}
			/>
			<button type="button">outside</button>
		</div>,
	);
}

function trigger(): HTMLElement {
	return screen.getByRole("button", {name: "Read by Claude"});
}

describe("InfoTip", () => {
	it("renders upstream's trigger and icon", () => {
		renderTip();
		const button = trigger();
		expect({
			type: button.getAttribute("type"),
			infoTip: button.getAttribute("data-info-tip"),
			classes: button.className.split(" "),
			icon: button.contains(screen.getByTestId("glyph")),
		}).toEqual({
			type: "button",
			infoTip: "",
			classes: [
				"inline-flex",
				"shrink-0",
				"items-center",
				"justify-center",
				"rounded-r5",
				"p-1",
				"-m-1",
				"text-ink-muted",
				"outline-none",
				"transition-colors",
				"duration-150",
				"hover:text-secondary",
				"focus-visible:text-secondary",
				"focus-visible:shadow-focus",
				"data-[popup-open]:text-secondary",
			],
			icon: true,
		});
	});

	it("opens a labelled dialog on click and moves focus into it", async () => {
		renderTip();
		fireEvent.click(trigger());
		const dialog = await screen.findByRole("dialog", {name: "Read by Claude"});
		const span = dialog.querySelector("span");
		expect({
			text: dialog.textContent,
			expanded: trigger().getAttribute("aria-expanded"),
			popupOpen: trigger().hasAttribute("data-popup-open"),
			spanClass: span?.className,
		}).toEqual({
			text: "Read by Claude",
			expanded: "true",
			popupOpen: true,
			spanClass: "block px-2 py-1.5 min-w-0 break-words",
		});
		await waitFor(() => {
			expect(dialog.contains(document.activeElement)).toBe(true);
		});
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		renderTip();
		fireEvent.click(trigger());
		const dialog = await screen.findByRole("dialog", {name: "Read by Claude"});
		await waitFor(() => {
			expect(dialog.contains(document.activeElement)).toBe(true);
		});
		fireEvent.keyDown(document.activeElement ?? dialog, {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(document.activeElement).toBe(trigger());
	});

	it("opens on hover without a click when delay is 0", async () => {
		vi.useFakeTimers();
		renderTip(0);
		act(() => {
			fireEvent.pointerEnter(trigger(), {pointerType: "mouse"});
			fireEvent.mouseEnter(trigger());
			fireEvent.mouseMove(trigger());
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});
		expect(screen.getByRole("dialog", {name: "Read by Claude"}).textContent).toBe("Read by Claude");
	});

	it("does not open on hover before the default 300ms delay", async () => {
		vi.useFakeTimers();
		renderTip();
		act(() => {
			fireEvent.pointerEnter(trigger(), {pointerType: "mouse"});
			fireEvent.mouseEnter(trigger());
			fireEvent.mouseMove(trigger());
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
