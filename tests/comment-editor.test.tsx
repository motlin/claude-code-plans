// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {CommentEditor, type CommentEditorProps} from "../src/components/comment-editor";

afterEach(cleanup);

const CARD_CLASS =
	"group/card relative isolate flex flex-col transition-colors gap-1.5 px-3 py-2.5 font-sans bg-surface-3 rounded-r4 border";
const TEXTAREA_CLASS =
	"hide-focus-ring focus-visible:outline-hidden flex-1 min-w-0 resize-none border-none bg-transparent text-pane text-primary placeholder:text-ink-muted";
const ICON_BUTTON_CLASS =
	"rounded-sm p-0.75 text-ink-muted hover:bg-fill-ghost-hover hover:text-primary disabled:opacity-40";
const REVEAL_CLASS =
	"relative rounded-sm p-0.75 text-ink-muted opacity-0 transition-opacity motion-reduce:transition-none hover:bg-fill-ghost-hover focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 touch:opacity-100";
const BODY_CLASS =
	"hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus rounded-r2 flex-1 min-w-0 cursor-text select-text whitespace-pre-wrap break-words text-pane text-primary before:absolute before:inset-0 before:content-['']";

function Controlled(props: Partial<CommentEditorProps> & {initial?: string}) {
	const {initial = "", ...rest} = props;
	const [value, setValue] = useState(initial);
	return <CommentEditor value={value} onChange={setValue} onSave={() => {}} onCancel={() => {}} {...rest} />;
}

function card(): HTMLElement {
	const label = screen.getByText("Line 3");
	const el = label.parentElement;
	if (el === null) throw new Error("no card");
	return el;
}

describe("CommentEditor", () => {
	it("renders the editing inline card with upstream's classes and defaults", () => {
		const {container} = render(<Controlled isEditing label="Line 3" />);
		const textarea = screen.getByRole("textbox");
		const save = screen.getByRole("button", {name: "Save comment"});
		const before = {
			wrapper: (container.firstElementChild as HTMLElement).className,
			card: card().className,
			label: screen.getByText("Line 3").className,
			row: textarea.parentElement?.className,
			slot: save.closest("div")?.className,
			saveSpan: save.parentElement?.className,
			textarea: {
				className: textarea.className,
				label: textarea.getAttribute("aria-label"),
				placeholder: textarea.getAttribute("placeholder"),
				rows: textarea.getAttribute("rows"),
				fieldSizing: textarea.style.getPropertyValue("field-sizing"),
			},
			save: {className: save.className, disabled: (save as HTMLButtonElement).disabled},
		};
		expect(before).toEqual({
			wrapper: "px-2 py-1",
			card: `${CARD_CLASS} border-border`,
			label: "text-[12px] leading-[15px] text-ink-muted",
			row: "flex items-center gap-1",
			slot: "shrink-0 h-6 flex items-center w-6 justify-center self-end",
			saveSpan: "inline-flex",
			textarea: {
				className: TEXTAREA_CLASS,
				label: "Comment",
				placeholder: "Add a comment",
				rows: "1",
				fieldSizing: "content",
			},
			save: {className: ICON_BUTTON_CLASS, disabled: true},
		});
		fireEvent.change(textarea, {target: {value: "abc"}});
		expect((save as HTMLButtonElement).disabled).toBe(false);
	});

	it("saves the trimmed text on Enter and ⌘Enter, and ignores Shift, IME and repeat", () => {
		const onSave = vi.fn<CommentEditorProps["onSave"]>();
		render(<Controlled isEditing initial={" abc\n"} onSave={onSave} />);
		const textarea = screen.getByRole("textbox");
		fireEvent.keyDown(textarea, {key: "Enter"});
		fireEvent.keyDown(textarea, {key: "Enter", metaKey: true});
		fireEvent.keyDown(textarea, {key: "Enter", ctrlKey: true});
		fireEvent.keyDown(textarea, {key: "Enter", shiftKey: true});
		fireEvent.keyDown(textarea, {key: "Enter", isComposing: true});
		fireEvent.keyDown(textarea, {key: "Enter", keyCode: 229});
		fireEvent.keyDown(textarea, {key: "Enter", repeat: true});
		fireEvent.click(screen.getByRole("button", {name: "Save comment"}));
		expect(onSave.mock.calls).toEqual([
			["abc", {submit: false, viaKeyboard: true}],
			["abc", {submit: true, viaKeyboard: true}],
			["abc", {submit: true, viaKeyboard: true}],
			["abc", {submit: false, viaKeyboard: false}],
		]);
	});

	it("routes ⌘Enter to onChordEnter when given", () => {
		const onSave = vi.fn<CommentEditorProps["onSave"]>();
		const onChordEnter = vi.fn<(text: string) => void>();
		render(<Controlled isEditing initial="abc " onSave={onSave} onChordEnter={onChordEnter} />);
		fireEvent.keyDown(screen.getByRole("textbox"), {key: "Enter", metaKey: true});
		expect({save: onSave.mock.calls, chord: onChordEnter.mock.calls}).toEqual({save: [], chord: [["abc"]]});
	});

	it("cancels on Escape even with text", () => {
		const onCancel = vi.fn<() => void>();
		render(<Controlled isEditing initial="abc" onCancel={onCancel} />);
		fireEvent.keyDown(screen.getByRole("textbox"), {key: "Escape"});
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("draws the accent border on the active card", () => {
		render(<Controlled isEditing isActive label="Line 3" />);
		expect({className: card().className, borderColor: card().style.borderColor}).toEqual({
			className: CARD_CLASS,
			borderColor: "var(--color-fill-accent)",
		});
	});

	it("renders a saved card with an activatable body and revealed Edit and Delete", () => {
		const onActivate = vi.fn<() => void>();
		const onDelete = vi.fn<() => void>();
		render(<Controlled initial="Rename" label="Line 3" onActivate={onActivate} onDelete={onDelete} />);
		const body = screen.getByRole("button", {name: "Rename"});
		const edit = screen.getByRole("button", {name: "Edit comment"});
		const remove = screen.getByRole("button", {name: "Delete comment"});
		expect({
			body: body.className,
			tabIndex: body.tabIndex,
			span: body.firstElementChild?.className,
			slot: edit.closest("div")?.className,
			edit: edit.className,
			remove: remove.className,
		}).toEqual({
			body: BODY_CLASS,
			tabIndex: 0,
			span: "relative",
			slot: "shrink-0 h-6 flex items-center gap-0.75 self-start",
			edit: `${REVEAL_CLASS} hover:text-primary`,
			remove: `${REVEAL_CLASS} hover:text-danger-000`,
		});
		fireEvent.keyDown(body, {key: "Enter"});
		fireEvent.keyDown(body, {key: " "});
		fireEvent.keyUp(body, {key: " "});
		fireEvent.keyDown(body, {key: "Enter", metaKey: true});
		fireEvent.click(body);
		fireEvent.click(edit);
		fireEvent.click(remove);
		expect({activate: onActivate.mock.calls.length, remove: onDelete.mock.calls.length}).toEqual({
			activate: 4,
			remove: 1,
		});
	});

	it("renders a plain paragraph without onActivate", () => {
		render(<Controlled initial="Rename" />);
		expect(screen.getByText("Rename").tagName).toBe("P");
		expect(screen.queryByRole("button", {name: "Edit comment"})).toBeNull();
	});

	it("disables Save and shows the reason when saveDisabledReason is set", () => {
		const onSave = vi.fn<CommentEditorProps["onSave"]>();
		render(<Controlled isEditing initial="abc" saveDisabledReason="Posting." onSave={onSave} />);
		const status = screen.getByRole("status");
		fireEvent.keyDown(screen.getByRole("textbox"), {key: "Enter"});
		expect({
			disabled: screen.getByRole("button", {name: "Save comment"}).hasAttribute("disabled"),
			status: {text: status.textContent, className: status.className},
			saves: onSave.mock.calls,
		}).toEqual({
			disabled: true,
			status: {text: "Posting.", className: "text-[12px] leading-[15px] text-ink-muted"},
			saves: [],
		});
	});

	it("renders the floating variant without border or wrapper, capped at 8lh", () => {
		const {container} = render(<Controlled variant="floating" isEditing label="Line 3" />);
		const textarea = screen.getByRole("textbox");
		expect({
			root: (container.firstElementChild as HTMLElement).className,
			maxHeight: textarea.style.maxHeight,
		}).toEqual({
			root: "group/card relative isolate flex flex-col transition-colors gap-1.5 px-3 py-2.5 font-sans rounded-[inherit]",
			maxHeight: "8lh",
		});
	});

	it("puts the caret at the end on autoFocus", () => {
		render(<Controlled isEditing autoFocus initial="abc" />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
		expect({focused: document.activeElement === textarea, caret: textarea.selectionStart}).toEqual({
			focused: true,
			caret: 3,
		});
	});

	it("retries autoFocus until an unslotted textarea renders and takes focus", async () => {
		// A diff annotation's card mounts before the diff library adds its shadow <slot>, so the first focus() is a no-op.
		const realFocus = HTMLTextAreaElement.prototype.focus;
		let slotted = false;
		const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(function (
			this: HTMLTextAreaElement,
			options?: FocusOptions,
		) {
			if (slotted) realFocus.call(this, options);
		});
		render(<Controlled isEditing autoFocus initial="abc" />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
		const before = document.activeElement === textarea;
		slotted = true;

		await waitFor(() => {
			expect(document.activeElement).toBe(textarea);
		});
		focus.mockRestore();
		expect({before, caret: textarea.selectionStart}).toStrictEqual({before: false, caret: 3});
	});
});
