// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SendRejectedCard} from "../src/components/send-rejected-card";

afterEach(cleanup);

function renderCard(nonResendable = false) {
	const onRetry = vi.fn<() => void>();
	const onDismiss = vi.fn<() => void>();
	const view = render(
		<SendRejectedCard
			rejection={{prompt: "hi", message: "send failed:\n  pane 3 is gone", nonResendable}}
			onRetry={onRetry}
			onDismiss={onDismiss}
		/>,
	);
	return {...view, onRetry, onDismiss};
}

const buttonNames = () =>
	screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);

describe("SendRejectedCard", () => {
	it("announces upstream's generic headline and hint", () => {
		renderCard();

		expect(screen.getByRole("alert").textContent).toEqual(
			"Something went wrong Try sending your message again. If it keeps failing, the error details show why.",
		);
	});

	it("orders its buttons Dismiss, View details, Try again, Copy details", () => {
		renderCard();

		expect(buttonNames()).toEqual(["Dismiss", "View details", "Try again", "Copy details"]);
	});

	it("opens the details by default and collapses them, unmounting the message", () => {
		const {container} = renderCard();
		const toggle = screen.getByRole("button", {name: "View details"});

		expect({
			expanded: toggle.getAttribute("aria-expanded"),
			message: container.querySelector("[data-send-rejected-message]")?.textContent,
		}).toEqual({expanded: "true", message: "send failed:\n  pane 3 is gone"});

		fireEvent.click(toggle);

		expect({
			expanded: toggle.getAttribute("aria-expanded"),
			message: container.querySelector("[data-send-rejected-message]"),
			buttons: buttonNames(),
		}).toEqual({expanded: "false", message: null, buttons: ["Dismiss", "View details", "Try again"]});
	});

	it("drops Try again and swaps the hint for a prompt that cannot be resent", () => {
		renderCard(true);

		expect({
			alert: screen.getByRole("alert").textContent,
			buttons: buttonNames(),
		}).toEqual({
			alert: "Something went wrong Your message didn’t send. Check the error details before sending it again.",
			buttons: ["Dismiss", "View details", "Copy details"],
		});
	});

	it("wires Try again, Dismiss and Copy details", () => {
		const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
		Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
		const {onRetry, onDismiss} = renderCard();

		fireEvent.click(screen.getByRole("button", {name: "Try again"}));
		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));
		fireEvent.click(screen.getByRole("button", {name: "Copy details"}));

		expect({
			retry: onRetry.mock.calls.length,
			dismiss: onDismiss.mock.calls.length,
			copied: writeText.mock.calls,
		}).toEqual({retry: 1, dismiss: 1, copied: [["send failed:\n  pane 3 is gone"]]});
	});

	it("uses upstream's card shell and lets the details row wrap on a phone", () => {
		const {container} = renderCard();
		const card = container.querySelector("[data-testid=send-rejected-card]");
		const row = screen.getByRole("button", {name: "View details"}).parentElement;

		expect({
			card: card?.className,
			row: row?.className.split(/\s+/).includes("flex-wrap"),
		}).toEqual({
			card: "card-outline flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-r7 select-text text-[13px]/[19px]",
			row: true,
		});
	});
});
