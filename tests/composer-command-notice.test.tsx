// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import type {SlashCommand} from "../src/lib/slash-commands";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

const COMMANDS: SlashCommand[] = [
	{name: "status", description: "Show session status", source: "builtin"},
	{name: "compact", description: "Compact the conversation", source: "builtin"},
	{name: "build:dev-server", description: "Start a dev server", source: "plugin-skill", pluginName: "build"},
];

function setup(commands: readonly SlashCommand[] = COMMANDS) {
	const onSend = vi.fn<(prompt: string) => void>();
	render(<Composer variant="session" draftKey="session-alice" onSend={onSend} slashCommands={commands} />);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	const submit = (text: string) => {
		fireEvent.change(textarea, {target: {value: text}});
		fireEvent.keyDown(textarea, {key: "Enter"});
	};
	return {textarea, onSend, submit};
}

function notice(): HTMLElement | null {
	return document.querySelector<HTMLElement>("[data-composer-command-notice]");
}

describe("Composer unknown-command notice", () => {
	it("sends a mistyped command and explains it with a did-you-mean button", () => {
		const {onSend, submit} = setup();

		submit("/statuss");
		const element = notice();
		const button = element?.querySelector("button");

		expect({
			sent: onSend.mock.calls.map(([prompt]) => prompt),
			className: element?.className,
			text: element?.querySelector("span")?.textContent,
			button: button?.textContent,
			buttonClassName: button?.className,
		}).toStrictEqual({
			sent: ["/statuss"],
			className: "mb-1.5 flex flex-wrap items-center gap-2 ps-1 text-footnote text-upstream-warning select-text",
			text: "/statuss isn’t a command here.",
			button: "Use /status",
			buttonClassName:
				"inline-flex h-5 items-center rounded-r5 bg-fill-secondary px-1.5 text-footnote text-primary shadow-field-drop hover:bg-fill-secondary-hover focus-visible:shadow-focus focus-visible:outline-hidden",
		});
	});

	it("fills the composer with the suggestion on Use without sending again", () => {
		const {textarea, onSend, submit} = setup();

		submit("/statuss");
		fireEvent.click(screen.getByRole("button", {name: "Use /status"}));

		expect({
			notice: notice(),
			value: textarea.value,
			caret: [textarea.selectionStart, textarea.selectionEnd],
			focused: document.activeElement === textarea,
			sends: onSend.mock.calls.length,
		}).toStrictEqual({
			notice: null,
			value: "/status ",
			caret: [8, 8],
			focused: true,
			sends: 1,
		});
	});

	it("keeps newly typed text after the suggestion", () => {
		const {textarea, submit} = setup();

		submit("/statuss");
		fireEvent.change(textarea, {target: {value: "  details "}});
		fireEvent.click(screen.getByRole("button", {name: "Use /status"}));

		expect(textarea.value).toBe("/status details");
	});

	it("keeps the typed casing in the notice and matches case-insensitively", () => {
		const {submit} = setup();

		submit("/Statuss");

		expect({
			text: notice()?.querySelector("span")?.textContent,
			button: notice()?.querySelector("button")?.textContent,
		}).toStrictEqual({text: "/Statuss isn’t a command here.", button: "Use /status"});
	});

	it("shows the notice without a button when nothing is close", () => {
		const {submit} = setup();

		submit("/zzzz");

		expect({text: notice()?.textContent, buttons: notice()?.querySelectorAll("button").length}).toStrictEqual({
			text: "/zzzz isn’t a command here.",
			buttons: 0,
		});
	});

	it("stays quiet for known commands, listed plugin skills, and an unloaded list", () => {
		const known = setup();
		known.submit("/status");
		const afterStatus = notice();
		known.submit("/build:dev-server now");
		const afterPlugin = notice();
		known.submit("/doctor");
		const afterCliOnly = notice();
		cleanup();
		const unloaded = setup([]);
		unloaded.submit("/statuss");

		expect({
			afterStatus,
			afterPlugin,
			afterCliOnly,
			afterUnloaded: notice(),
			sent: unloaded.onSend.mock.calls.map(([prompt]) => prompt),
		}).toStrictEqual({
			afterStatus: null,
			afterPlugin: null,
			afterCliOnly: null,
			afterUnloaded: null,
			sent: ["/statuss"],
		});
	});

	it("survives typing and clears on the next submit", () => {
		const {textarea, submit} = setup();

		submit("/statuss");
		fireEvent.change(textarea, {target: {value: "hello"}});
		const whileTyping = notice()?.querySelector("span")?.textContent;
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({whileTyping, afterSubmit: notice()}).toStrictEqual({
			whileTyping: "/statuss isn’t a command here.",
			afterSubmit: null,
		});
	});
});
