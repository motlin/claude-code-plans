// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";

beforeAll(async () => {
	await preloadComposerSurfaces();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

function setup(variant: "session" | "home") {
	const handlers = {
		onSend: vi.fn<(prompt: string) => void>(),
		onOpenContext: vi.fn<() => void>(),
		toast: vi.fn<(options: ToastOptions) => void>(),
	};
	render(
		<ToastContext.Provider value={handlers.toast}>
			<Composer
				variant={variant}
				draftKey={variant === "home" ? "home" : "session-alice"}
				onSend={(prompt) => {
					handlers.onSend(prompt);
				}}
				onOpenContext={variant === "session" ? handlers.onOpenContext : undefined}
			/>
		</ToastContext.Provider>,
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	function submit(text: string) {
		fireEvent.change(textarea, {target: {value: text}});
		fireEvent.keyDown(textarea, {key: "Enter"});
	}
	return {handlers, textarea, submit};
}

function calls(handlers: ReturnType<typeof setup>["handlers"]) {
	return {
		onSend: handlers.onSend.mock.calls,
		onOpenContext: handlers.onOpenContext.mock.calls.length,
		toast: handlers.toast.mock.calls,
	};
}

describe("/autocompact in a session composer", () => {
	it("opens the Context card instead of sending a bare /autocompact, and clears the composer", () => {
		const {handlers, textarea, submit} = setup("session");
		submit("/autocompact");

		expect({...calls(handlers), text: textarea.value}).toStrictEqual({
			onSend: [],
			onOpenContext: 1,
			toast: [],
			text: "",
		});
	});

	it("sends /autocompact with an argument to the CLI as typed", () => {
		const {handlers, submit} = setup("session");
		submit("/autocompact 50000");

		expect(calls(handlers)).toStrictEqual({onSend: [["/autocompact 50000"]], onOpenContext: 0, toast: []});
	});

	it("leaves /context to the CLI", () => {
		const {handlers, submit} = setup("session");
		submit("/context");

		expect(calls(handlers)).toStrictEqual({onSend: [["/context"]], onOpenContext: 0, toast: []});
	});
});

describe("/autocompact on the home composer", () => {
	it("refuses a bare /autocompact with upstream's toast and keeps the text", () => {
		const {handlers, textarea, submit} = setup("home");
		submit("/autocompact");

		expect({...calls(handlers), text: textarea.value}).toStrictEqual({
			onSend: [],
			onOpenContext: 0,
			toast: [
				[
					{
						kind: "error",
						message: "Context settings work once this session starts. Send your first message to start it.",
					},
				],
			],
			text: "/autocompact",
		});
	});

	it("launches with /autocompact and an argument as before", () => {
		const {handlers, submit} = setup("home");
		submit("/autocompact 5000");

		expect(calls(handlers)).toStrictEqual({onSend: [["/autocompact 5000"]], onOpenContext: 0, toast: []});
	});
});
