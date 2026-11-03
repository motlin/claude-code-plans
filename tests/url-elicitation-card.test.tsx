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

function heldButtons() {
	return screen.getAllByRole("button").map((button) => ({
		text: button.textContent,
		label: button.getAttribute("aria-label"),
		busy: button.getAttribute("aria-busy"),
		disabled: button.hasAttribute("disabled"),
	}));
}

function disabledReasons(): string[] {
	return [...document.querySelectorAll("[data-cds-disabled-reason]")].map((node) => node.textContent);
}

describe("UrlElicitationCard", () => {
	it("draws upstream's link card: title, host and URL card, message, caution, and Decline / Open link", () => {
		const {container} = render(
			<UrlElicitationCard
				serverName="docs"
				message="Sign in"
				url="https://example.com/auth?x=1"
				dialogFocus={focusOf(URL_ACCEPT_FOCUSED)}
				onDecision={noDecision}
			/>,
		);
		const body = container.querySelector("[data-approval-card-body]");
		const link = container.querySelector("[data-testid=epitaxy-elicitation-link]");
		const cardBody = link?.querySelector("[data-cds-card-body]");
		const caution = container.querySelector("[data-testid=epitaxy-elicitation-caution]");

		expect({
			label: container.querySelector("[data-approval-card-root]")?.getAttribute("aria-label"),
			order: [...(body?.children ?? [])].map((child) => child.tagName),
			title: body?.querySelector("[data-question-stop-name]")?.textContent,
			titleStop: body?.querySelector("[data-approval-card-title]")?.getAttribute("data-question-stop-name"),
			link: {
				cds: link?.getAttribute("data-cds"),
				size: link?.getAttribute("data-size"),
				class: link?.getAttribute("class"),
				bodyClass: cardBody?.getAttribute("class"),
				spans: [...(cardBody?.children ?? [])].map((span) => [
					span.tagName,
					span.getAttribute("class"),
					span.textContent,
				]),
			},
			message: [
				body?.lastElementChild?.tagName,
				body?.lastElementChild?.getAttribute("class"),
				body?.lastElementChild?.textContent,
			],
			caution: [caution?.tagName, caution?.getAttribute("class"), caution?.textContent],
			cautionAfterBody: caution?.previousElementSibling === body,
			buttons: buttonStates(),
			primary: screen.getByRole("button", {name: "Open link"}).getAttribute("data-approval-variant"),
			reasons: disabledReasons(),
		}).toStrictEqual({
			label: "docs wants to open a URL",
			order: ["DIV", "DIV", "P"],
			title: "docs wants to open a URL",
			titleStop: "",
			link: {
				cds: "Card",
				size: "sm",
				class: "group/card relative isolate flex flex-col rounded-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-card-ring after:content-['']",
				bodyClass:
					"cds-card-body flex min-h-0 flex-1 flex-col self-stretch [gap:inherit] [align-items:inherit] [justify-content:inherit] rounded-[inherit] p-3",
				spans: [
					[
						"SPAN",
						"text-body min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext] font-medium text-primary",
						"example.com",
					],
					[
						"SPAN",
						"text-body min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext] text-secondary",
						"https://example.com/auth?x=1",
					],
				],
			},
			message: [
				"P",
				"text-body min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext] text-secondary whitespace-pre-wrap",
				"Sign in",
			],
			caution: ["P", "text-body text-muted-as-secondary", "This opens a site outside Claude."],
			cautionAfterBody: true,
			buttons: [
				{name: "Decline", disabled: false},
				{name: "Open link", disabled: false},
			],
			primary: "primary",
			reasons: [],
		});
	});

	it("names an empty server and omits an empty message", () => {
		const {container} = render(
			<UrlElicitationCard serverName=" " message="" url={PROPS.url} dialogFocus={null} onDecision={noDecision} />,
		);
		const body = container.querySelector("[data-approval-card-body]");

		expect({
			title: body?.querySelector("[data-question-stop-name]")?.textContent,
			order: [...(body?.children ?? [])].map((child) => child.tagName),
		}).toStrictEqual({title: "An unknown server wants to open a URL", order: ["DIV", "DIV"]});
	});

	it("answers Open link with allow, busy, and Decline disabled until the result clears the card", async () => {
		const onDecision = vi.fn<(decision: ElicitationDecision) => Promise<void>>().mockResolvedValue();
		render(<UrlElicitationCard {...PROPS} dialogFocus={focusOf(URL_ACCEPT_FOCUSED)} onDecision={onDecision} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Open link"}));
			await Promise.resolve();
		});

		expect({calls: onDecision.mock.calls, buttons: heldButtons()}).toStrictEqual({
			calls: [["allow"]],
			buttons: [
				{text: "Decline", label: null, busy: null, disabled: true},
				{text: "Open link", label: "Sending…", busy: "true", disabled: false},
			],
		});
	});

	it("marks Decline busy and Open link disabled while declining", async () => {
		const onDecision = vi.fn<(decision: ElicitationDecision) => Promise<void>>(
			async () => new Promise<void>(() => {}),
		);
		render(<UrlElicitationCard {...PROPS} dialogFocus={focusOf(URL_ACCEPT_FOCUSED)} onDecision={onDecision} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Decline"}));
			await Promise.resolve();
		});

		expect(heldButtons()).toStrictEqual([
			{text: "Decline", label: "Sending…", busy: "true", disabled: false},
			{text: "Open link", label: null, busy: null, disabled: true},
		]);
	});

	it("disables Open link with a reason when the terminal dialog starts on Decline, and declines with deny", async () => {
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
					{name: "Open link", disabled: true},
				],
				reasons: [URL_OPEN_UNAVAILABLE_REASON],
			},
			calls: [["deny"]],
		});
	});

	it("disables Open link while the dialog is still being read", () => {
		render(<UrlElicitationCard {...PROPS} dialogFocus={undefined} onDecision={noDecision} />);

		expect({buttons: buttonStates(), reasons: disabledReasons()}).toStrictEqual({
			buttons: [
				{name: "Decline", disabled: false},
				{name: "Open link", disabled: true},
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
			fireEvent.click(screen.getByRole("button", {name: "Open link"}));
			await Promise.resolve();
		});

		expect({alert: screen.getByRole("alert").textContent, buttons: buttonStates()}).toStrictEqual({
			alert: "The terminal is not showing this elicitation",
			buttons: [
				{name: "Decline", disabled: false},
				{name: "Open link", disabled: false},
			],
		});
	});
});
