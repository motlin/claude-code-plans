// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import type {LaunchOptions} from "../src/lib/launch-options";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.useRealTimers();
});

function renderComposer({
	onFork,
	forkLabel,
}: {
	onFork?: (prompt: string, launchOptions: LaunchOptions) => void;
	forkLabel?: string;
}) {
	const onSend = vi.fn<(prompt: string) => void>();
	const onSendNow = vi.fn<(prompt: string) => void>();
	render(
		<Composer
			variant="session"
			draftKey="session-alice"
			onSend={(prompt) => onSend(prompt)}
			onSendNow={onSendNow}
			onFork={onFork}
			forkLabel={forkLabel}
		/>,
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	return {textarea, onSend, onSendNow};
}

describe("Fork with this prompt", () => {
	it("forks on ⌥⌘⏎ and Ctrl+Alt+⏎ without touching Send or Send now", () => {
		const onFork = vi.fn<(prompt: string, launchOptions: LaunchOptions) => void>();
		const {textarea, onSend, onSendNow} = renderComposer({onFork});

		fireEvent.change(textarea, {target: {value: "Try Alice's idea"}});
		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true, altKey: true});
		fireEvent.change(textarea, {target: {value: "Try Bob's idea"}});
		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", ctrlKey: true, altKey: true});

		expect({
			fork: onFork.mock.calls,
			send: onSend.mock.calls,
			now: onSendNow.mock.calls,
			cleared: textarea.value,
		}).toStrictEqual({
			fork: [
				["Try Alice's idea", {}],
				["Try Bob's idea", {}],
			],
			send: [],
			now: [],
			cleared: "",
		});
	});

	it("keeps ⌘⏎ as Send now when forking is available", () => {
		const onFork = vi.fn<(prompt: string, launchOptions: LaunchOptions) => void>();
		const {textarea, onSendNow} = renderComposer({onFork});

		fireEvent.change(textarea, {target: {value: "Alice's urgent prompt"}});
		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true});

		expect({fork: onFork.mock.calls, now: onSendNow.mock.calls}).toStrictEqual({
			fork: [],
			now: [["Alice's urgent prompt"]],
		});
	});

	it("does nothing on ⌥⌘⏎ with an empty prompt", () => {
		const onFork = vi.fn<(prompt: string, launchOptions: LaunchOptions) => void>();
		const {textarea} = renderComposer({onFork});

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true, altKey: true});

		expect(onFork.mock.calls).toStrictEqual([]);
	});

	it("stacks the fork shortcut on its own row under Send in the tooltip", () => {
		vi.useFakeTimers();
		renderComposer({onFork: () => {}, forkLabel: "Fork with this prompt"});

		fireEvent.pointerEnter(screen.getByRole("button", {name: "Send"}));
		act(() => {
			vi.advanceTimersByTime(300);
		});

		const tooltip = screen.getByRole("tooltip");
		expect({
			rows: [...tooltip.children].map((row) => row.textContent),
			separators: [...tooltip.querySelectorAll("span")].filter((span) => span.textContent === "·").length,
		}).toStrictEqual({rows: ["Send⏎", "Fork with this promptCtrl+Alt+⏎"], separators: 0});
	});

	it("labels the headless fork as Send in a forked session", () => {
		vi.useFakeTimers();
		renderComposer({onFork: () => {}, forkLabel: "Send in a forked session"});

		fireEvent.pointerEnter(screen.getByRole("button", {name: "Send"}));
		act(() => {
			vi.advanceTimersByTime(300);
		});

		const tooltip = screen.getByRole("tooltip");
		expect({
			rows: [...tooltip.children].map((row) => row.textContent),
			separators: [...tooltip.querySelectorAll("span")].filter((span) => span.textContent === "·").length,
		}).toStrictEqual({rows: ["Send⏎", "Send in a forked sessionCtrl+Alt+⏎"], separators: 0});
	});
});
