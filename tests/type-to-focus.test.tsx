// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {Composer} from "../src/components/composer";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

function prompts(): HTMLTextAreaElement[] {
	return screen.getAllByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
}

/** The composer focuses itself on mount; typing "on the body" starts from nothing focused. */
function blurToBody(): void {
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function state(textarea: HTMLTextAreaElement) {
	return {value: textarea.value, focused: document.activeElement === textarea};
}

describe("type-to-focus", () => {
	it("moves a printable key typed on the body into the composer", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();

		const dispatched = fireEvent.keyDown(document.body, {key: "x"});

		expect({...state(prompts()[0]!), dispatched}).toStrictEqual({value: "x", focused: true, dispatched: false});
	});

	it("inserts at the composer's caret and keeps the existing draft", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const textarea = prompts()[0]!;
		fireEvent.change(textarea, {target: {value: "plant basil"}});
		textarea.setSelectionRange(5, 5);
		textarea.blur();

		fireEvent.keyDown(document.body, {key: "s"});

		expect({...state(textarea), caret: textarea.selectionStart}).toStrictEqual({
			value: "plants basil",
			focused: true,
			caret: 6,
		});
	});

	it("moves a key typed on a focused button into the composer, but leaves Space to press the button", () => {
		render(
			<>
				<button type="button">Rename</button>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		const button = screen.getByRole("button", {name: "Rename"});
		button.focus();
		const space = fireEvent.keyDown(button, {key: " "});
		const afterSpace = state(prompts()[0]!);

		button.focus();
		fireEvent.keyDown(button, {key: "r"});

		expect({space, afterSpace, afterR: state(prompts()[0]!)}).toStrictEqual({
			space: true,
			afterSpace: {value: "", focused: false},
			afterR: {value: "r", focused: true},
		});
	});

	it("ignores modifier chords, non-printable keys, IME composition and keys another handler claimed", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();
		const claim = (event: KeyboardEvent) => {
			event.preventDefault();
		};
		document.addEventListener("keydown", claim);
		fireEvent.keyDown(document.body, {key: "c"});
		document.removeEventListener("keydown", claim);

		const results = [
			fireEvent.keyDown(document.body, {key: "x", metaKey: true}),
			fireEvent.keyDown(document.body, {key: "x", ctrlKey: true}),
			fireEvent.keyDown(document.body, {key: "x", altKey: true}),
			fireEvent.keyDown(document.body, {key: "Enter"}),
			fireEvent.keyDown(document.body, {key: "ArrowDown"}),
			fireEvent.keyDown(document.body, {key: "F6"}),
			fireEvent.keyDown(document.body, {key: "x", isComposing: true}),
		];

		expect({results, ...state(prompts()[0]!)}).toStrictEqual({
			results: [true, true, true, true, true, true, true],
			value: "",
			focused: false,
		});
	});

	it("leaves keys alone inside other fields, open menus and dialogs", () => {
		render(
			<>
				<input aria-label="Search" />
				<div role="menu" aria-label="Session actions">
					<div role="menuitem" tabIndex={-1}>
						Rename
					</div>
				</div>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		const search = screen.getByRole("textbox", {name: "Search"});
		search.focus();
		fireEvent.keyDown(search, {key: "a"});
		const item = screen.getByRole("menuitem", {name: "Rename"});
		item.focus();
		fireEvent.keyDown(item, {key: "r"});
		blurToBody();
		fireEvent.keyDown(document.body, {key: "b"});

		expect(state(prompts()[0]!)).toStrictEqual({value: "", focused: false});
	});

	it("does nothing while an aria-modal dialog is open, even with focus on the body", () => {
		render(
			<>
				<div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" />
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		blurToBody();

		fireEvent.keyDown(document.body, {key: "x"});

		expect(state(prompts()[0]!)).toStrictEqual({value: "", focused: false});
	});

	it("skips a disabled composer", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} disabled />);
		blurToBody();

		const dispatched = fireEvent.keyDown(document.body, {key: "x"});

		expect({...state(prompts()[0]!), dispatched}).toStrictEqual({value: "", focused: false, dispatched: true});
	});

	it("types only into the active pane's composer when two are mounted", () => {
		render(
			<>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} active={false} />
				<Composer variant="session" draftKey="session-bob" onSend={() => {}} active />
			</>,
		);
		blurToBody();

		fireEvent.keyDown(document.body, {key: "q"});

		expect(prompts().map(state)).toStrictEqual([
			{value: "", focused: false},
			{value: "q", focused: true},
		]);
	});
});
