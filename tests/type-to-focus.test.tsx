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

	it("leaves keys and pastes alone while focus is inside [data-owns-typing-and-pastes]", () => {
		render(
			<>
				<div data-owns-typing-and-pastes="">
					<button type="button">Pick</button>
				</div>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		const button = screen.getByRole("button", {name: "Pick"});
		button.focus();

		const key = fireEvent.keyDown(button, {key: "r"});
		const pasted = paste(button, "hi");

		expect({key, pasted, ...state(prompts()[0]!), buttonFocused: document.activeElement === button}).toStrictEqual({
			key: true,
			pasted: true,
			value: "",
			focused: false,
			buttonFocused: true,
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

function dictate(target: EventTarget, data: string, inputType = "insertText"): boolean {
	return target.dispatchEvent(new InputEvent("beforeinput", {inputType, data, bubbles: true, cancelable: true}));
}

describe("dictation-to-focus", () => {
	it("routes a dictated beforeinput insert with nothing focused into the composer", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();

		const dispatched = dictate(document.body, "plant basil");

		expect({...state(prompts()[0]!), dispatched}).toStrictEqual({
			value: "plant basil",
			focused: true,
			dispatched: false,
		});
	});

	it("routes an insertReplacementText dictation and appends at the caret", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const textarea = prompts()[0]!;
		fireEvent.change(textarea, {target: {value: "plant basil"}});
		textarea.setSelectionRange(11, 11);
		blurToBody();

		dictate(document.body, " today", "insertReplacementText");

		expect({...state(textarea), caret: textarea.selectionStart}).toStrictEqual({
			value: "plant basil today",
			focused: true,
			caret: 17,
		});
	});

	it("routes a composition commit with nothing focused into the composer once", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();

		document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true, data: ""}));
		document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "water"}));

		expect(state(prompts()[0]!)).toStrictEqual({value: "water", focused: true});
	});

	it("does not route a composition commit a beforeinput already inserted", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();

		document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true, data: ""}));
		dictate(document.body, "water", "insertFromComposition");
		document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "water"}));

		expect(state(prompts()[0]!)).toStrictEqual({value: "water", focused: true});
	});

	it("leaves dictation alone in other fields, open dialogs and a disabled composer", () => {
		const {rerender} = render(
			<>
				<input aria-label="Search" />
				<div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" />
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		const search = screen.getByRole("textbox", {name: "Search"});
		search.focus();
		const inField = dictate(search, "a");
		blurToBody();
		const inDialog = dictate(document.body, "b");
		rerender(<Composer variant="session" draftKey="session-alice" onSend={() => {}} disabled />);
		blurToBody();
		const disabled = dictate(document.body, "c");

		expect({inField, inDialog, disabled, ...state(prompts()[0]!)}).toStrictEqual({
			inField: true,
			inDialog: true,
			disabled: true,
			value: "",
			focused: false,
		});
	});

	it("keeps the composer focused with the caret at the end across a re-render between two dictations", () => {
		const {rerender} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const textarea = prompts()[0]!;
		textarea.focus();
		textarea.setRangeText("plant basil", 0, 0, "end");
		fireEvent.input(textarea);
		rerender(<Composer variant="session" draftKey="session-alice" onSend={() => {}} isStreaming={false} />);
		const afterRerender = {...state(textarea), caret: textarea.selectionStart};
		textarea.setRangeText(" today", textarea.selectionStart, textarea.selectionEnd, "end");
		fireEvent.input(textarea);

		expect({afterRerender, final: state(textarea)}).toStrictEqual({
			afterRerender: {value: "plant basil", focused: true, caret: 11},
			final: {value: "plant basil today", focused: true},
		});
	});

	it("takes focus back after a disabled flicker drops it, so the next dictation still lands", () => {
		const {rerender} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const textarea = prompts()[0]!;
		textarea.focus();
		textarea.setRangeText("plant basil", 0, 0, "end");
		fireEvent.input(textarea);
		rerender(<Composer variant="session" draftKey="session-alice" onSend={() => {}} disabled />);
		// Chrome blurs a focused textarea the moment it turns disabled; jsdom refuses to blur a disabled one.
		textarea.disabled = false;
		textarea.blur();
		textarea.disabled = true;
		rerender(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const afterFlicker = {...state(textarea), caret: textarea.selectionStart};
		textarea.setRangeText(" today", textarea.selectionStart, textarea.selectionEnd, "end");
		fireEvent.input(textarea);

		expect({afterFlicker, final: state(textarea)}).toStrictEqual({
			afterFlicker: {value: "plant basil", focused: true, caret: 11},
			final: {value: "plant basil today", focused: true},
		});
	});

	it("leaves focus where the user moved it while the composer was disabled", () => {
		const {rerender} = render(
			<>
				<button type="button">Rename</button>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		prompts()[0]!.focus();
		rerender(
			<>
				<button type="button">Rename</button>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} disabled />
			</>,
		);
		screen.getByRole("button", {name: "Rename"}).focus();
		rerender(
			<>
				<button type="button">Rename</button>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);

		expect(document.activeElement).toBe(screen.getByRole("button", {name: "Rename"}));
	});
});

/** jsdom has no DataTransfer; the hook reads only `files` and `getData`. */
function plainText(text: string) {
	return {files: [], getData: (format: string) => (format === "text/plain" ? text : "")};
}

function paste(target: EventTarget, text: string): boolean {
	const clipboardData = plainText(text);
	const event = new Event("paste", {bubbles: true, cancelable: true});
	Object.defineProperty(event, "clipboardData", {value: clipboardData});
	return target.dispatchEvent(event);
}

describe("paste-to-focus", () => {
	it("routes a paste with nothing focused into the composer, with no keydown first", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();

		const dispatched = paste(document.body, "plant basil");

		expect({...state(prompts()[0]!), dispatched}).toStrictEqual({
			value: "plant basil",
			focused: true,
			dispatched: false,
		});
	});

	it("focuses the editor when the composer card padding is clicked, so a native paste lands there", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();
		const card = document.querySelector<HTMLElement>("[data-composer-card]")!;
		fireEvent.mouseDown(card);
		fireEvent.click(card);

		expect(state(prompts()[0]!)).toStrictEqual({value: "", focused: true});
	});

	it("routes a paste that lands on a focused button into the composer at its caret", () => {
		render(
			<>
				<button type="button">Rename</button>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		const textarea = prompts()[0]!;
		fireEvent.change(textarea, {target: {value: "plant basil"}});
		textarea.setSelectionRange(5, 5);
		const button = screen.getByRole("button", {name: "Rename"});
		button.focus();

		paste(button, "s");

		expect({...state(textarea), caret: textarea.selectionStart}).toStrictEqual({
			value: "plants basil",
			focused: true,
			caret: 6,
		});
	});

	it("routes an insertFromPaste beforeinput with nothing focused into the composer", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();
		const event = new InputEvent("beforeinput", {inputType: "insertFromPaste", bubbles: true, cancelable: true});
		Object.defineProperty(event, "dataTransfer", {value: plainText("water")});

		document.body.dispatchEvent(event);

		expect(state(prompts()[0]!)).toStrictEqual({value: "water", focused: true});
	});

	it("leaves pastes alone in other fields, open dialogs, a disabled composer and when empty", () => {
		const {rerender} = render(
			<>
				<input aria-label="Search" />
				<div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" />
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} />
			</>,
		);
		const search = screen.getByRole("textbox", {name: "Search"});
		search.focus();
		const inField = paste(search, "a");
		blurToBody();
		const inDialog = paste(document.body, "b");
		rerender(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		blurToBody();
		const empty = paste(document.body, "");
		rerender(<Composer variant="session" draftKey="session-alice" onSend={() => {}} disabled />);
		blurToBody();
		const disabled = paste(document.body, "c");

		expect({inField, inDialog, empty, disabled, ...state(prompts()[0]!)}).toStrictEqual({
			inField: true,
			inDialog: true,
			empty: true,
			disabled: true,
			value: "",
			focused: false,
		});
	});
});
