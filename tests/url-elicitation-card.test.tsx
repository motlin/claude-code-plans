// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {
	URL_OPEN_LOADING_REASON,
	URL_OPEN_UNAVAILABLE_REASON,
	UrlElicitationCard,
} from "../src/components/approval-card";
import {parseElicitationDialog} from "../src/lib/herdr/elicitation-keys";
import type {ElicitationDecision} from "../src/lib/herdr/elicitation-keys";
import {URL_ACCEPT_FOCUSED, URL_DECLINE_FOCUSED} from "./fixtures/elicitation-screens";

afterEach(cleanup);

const PROPS = {
	serverName: "spike-elicit",
	message: "Open the spike page (url-decline)",
	url: "https://example.com/spike?step=1",
};

async function noDecision(): Promise<void> {
	return Promise.resolve();
}

function focusOf(screenText: string) {
	return parseElicitationDialog(screenText)?.focus ?? null;
}

function buttonStates() {
	return screen.getAllByRole("button").map((button) => ({
		name: button.textContent,
		disabled: button.hasAttribute("disabled"),
	}));
}

function disabledReasons(): string[] {
	return [...document.querySelectorAll("[data-cds-disabled-reason]")].map((node) => node.textContent);
}

describe("UrlElicitationCard", () => {
	it("names the server, bolds the URL's host and notes where the link opens", () => {
		const {container} = render(
			<UrlElicitationCard {...PROPS} dialogFocus={focusOf(URL_ACCEPT_FOCUSED)} onDecision={noDecision} />,
		);

		expect({
			title: screen.getByText("spike-elicit wants to open a URL").tagName,
			url: container.querySelector("[data-elicitation-url]")?.innerHTML,
			note: screen.getByText("Claude Code opens the link on the machine it runs on.").tagName,
			message: screen.getByText("Open the spike page (url-decline)").tagName,
			buttons: buttonStates(),
			reasons: disabledReasons(),
		}).toStrictEqual({
			title: "SPAN",
			url: "https://<strong>example.com</strong>/spike?step=1",
			note: "SPAN",
			message: "SPAN",
			buttons: [
				{name: "Decline", disabled: false},
				{name: "Open", disabled: false},
			],
			reasons: [],
		});
	});

	it("answers Open with allow, then holds both buttons until the result clears the card", async () => {
		const onDecision = vi.fn<(decision: ElicitationDecision) => Promise<void>>().mockResolvedValue();
		render(<UrlElicitationCard {...PROPS} dialogFocus={focusOf(URL_ACCEPT_FOCUSED)} onDecision={onDecision} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Open"}));
			await Promise.resolve();
		});

		expect({calls: onDecision.mock.calls, buttons: buttonStates()}).toStrictEqual({
			calls: [["allow"]],
			buttons: [
				{name: "Decline", disabled: true},
				{name: "Open", disabled: true},
			],
		});
	});

	it("disables Open with a reason when the terminal dialog starts on Decline, and declines with deny", async () => {
		const onDecision = vi.fn<(decision: ElicitationDecision) => Promise<void>>().mockResolvedValue();
		render(<UrlElicitationCard {...PROPS} dialogFocus={focusOf(URL_DECLINE_FOCUSED)} onDecision={onDecision} />);
		const before = {buttons: buttonStates(), reasons: disabledReasons()};

		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Decline"}));
			await Promise.resolve();
		});

		expect({before, calls: onDecision.mock.calls}).toStrictEqual({
			before: {
				buttons: [
					{name: "Decline", disabled: false},
					{name: "Open", disabled: true},
				],
				reasons: [URL_OPEN_UNAVAILABLE_REASON],
			},
			calls: [["deny"]],
		});
	});

	it("disables Open while the dialog is still being read", () => {
		render(<UrlElicitationCard {...PROPS} dialogFocus={undefined} onDecision={noDecision} />);

		expect({buttons: buttonStates(), reasons: disabledReasons()}).toStrictEqual({
			buttons: [
				{name: "Decline", disabled: false},
				{name: "Open", disabled: true},
			],
			reasons: [URL_OPEN_LOADING_REASON],
		});
	});

	it("shows a refused answer's error and re-enables the buttons", async () => {
		const onDecision = vi
			.fn<(decision: ElicitationDecision) => Promise<void>>()
			.mockRejectedValue(new Error("The terminal is not showing this elicitation"));
		render(<UrlElicitationCard {...PROPS} dialogFocus={focusOf(URL_ACCEPT_FOCUSED)} onDecision={onDecision} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Open"}));
			await Promise.resolve();
		});

		expect({alert: screen.getByRole("alert").textContent, buttons: buttonStates()}).toStrictEqual({
			alert: "The terminal is not showing this elicitation",
			buttons: [
				{name: "Decline", disabled: false},
				{name: "Open", disabled: false},
			],
		});
	});

	it("draws a URL without a scheme as plain text", () => {
		const {container} = render(
			<UrlElicitationCard {...PROPS} url="not a url" dialogFocus={null} onDecision={noDecision} />,
		);

		expect(container.querySelector("[data-elicitation-url]")?.innerHTML).toStrictEqual("not a url");
	});
});
