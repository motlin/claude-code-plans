// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SessionPlanPane} from "../src/components/panes/plan-pane";
import {addPlanComment, clearPlanComments, getPlanComments} from "../src/lib/plan-comments";
import type {SessionPlanModel} from "../src/lib/session-plan-model";

const SESSION = "fabricated-marks-session";

// Flattened text: "Tea plan\n" (0-9), "Brew one cup of tea." (9-29), "\n\n", "Green" (31-36), "\n", "Black" (37-42), …
const CONTENT = "# Tea plan\n\nBrew one cup of tea.\n\n- Green\n- Black\n\nPour it.";

const MARK_CLASS =
	"rounded-xs text-inherit underline decoration-[var(--color-fill-accent)] decoration-2 underline-offset-2 px-0";
const REST = "bg-[hsl(from_var(--color-fill-accent)_h_s_l/10%)]";
const HOVER = "bg-[hsl(from_var(--color-fill-accent)_h_s_l/20%)]";
const SPAN_CLASS = "text-inherit rounded-xs outline-none focus-visible:shadow-[var(--focus-shadow)]";

afterEach(() => {
	cleanup();
	clearPlanComments(SESSION);
});

function pane(content: string) {
	const model: SessionPlanModel = {content, todos: [], editsPlanFile: false};
	return (
		<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
			<SessionPlanPane sessionId={SESSION} planFilename={undefined} model={model} commentsEnabled />
		</QueryClientProvider>
	);
}

function marks(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>("mark[data-plan-comment-id]"));
}

function describeMarks() {
	return marks().map((mark) => {
		const span = mark.firstElementChild;
		return {
			id: mark.dataset["planCommentId"],
			className: mark.className,
			text: mark.textContent,
			span: {
				role: span?.getAttribute("role"),
				tabIndex: span?.getAttribute("tabindex"),
				className: span?.className,
			},
		};
	});
}

/** The button span inside the mark whose text is `text`. */
function markButton(text: string): Element {
	const button = marks().find((mark) => mark.textContent === text)?.firstElementChild;
	if (button === null || button === undefined) throw new Error(`no mark with ${text}`);
	return button;
}

function dialog(): HTMLElement | null {
	return document.querySelector('[role="dialog"][aria-label="Comment on selection"]');
}

describe("plan comment marks", () => {
	it("wraps each comment's text in upstream's mark and button span", () => {
		const one = addPlanComment(SESSION, {selectedText: "one", startOffset: 14, endOffset: 17, comment: "Two"});
		const green = addPlanComment(SESSION, {
			selectedText: "Green",
			startOffset: 31,
			endOffset: 36,
			comment: "Oolong",
		});
		render(pane(CONTENT));

		const span = {role: "button", tabIndex: "0", className: SPAN_CLASS};
		expect(describeMarks()).toStrictEqual([
			{id: one, className: `${MARK_CLASS} ${REST}`, text: "one", span},
			{id: green, className: `${MARK_CLASS} ${REST}`, text: "Green", span},
		]);
	});

	it("marks every text node of a comment that crosses list items, the newline between them included", () => {
		const id = addPlanComment(SESSION, {
			selectedText: "Green\nBlack",
			startOffset: 31,
			endOffset: 42,
			comment: "x",
		});
		render(pane(CONTENT));

		expect(marks().map((mark) => [mark.dataset["planCommentId"], mark.textContent])).toStrictEqual([
			[id, "Green"],
			[id, "\n"],
			[id, "Black"],
		]);
	});

	it("re-anchors a comment to the nearest occurrence of its text when the plan changes", () => {
		addPlanComment(SESSION, {selectedText: "plan", startOffset: 4, endOffset: 8, comment: "x"});
		const {rerender} = render(pane(CONTENT));
		const before = marks().map((mark) => [mark.parentElement?.textContent, mark.textContent]);
		rerender(pane(CONTENT.replace("Tea plan", "Iced tea plan")));

		expect({
			before,
			after: marks().map((mark) => [mark.parentElement?.textContent, mark.textContent]),
		}).toStrictEqual({before: [["Tea plan", "plan"]], after: [["Iced tea plan", "plan"]]});
	});

	it("drops the mark but keeps the comment when its text is gone", () => {
		addPlanComment(SESSION, {selectedText: "Green", startOffset: 31, endOffset: 36, comment: "x"});
		const {rerender} = render(pane(CONTENT));
		rerender(pane(CONTENT.replace("Green", "White")));

		expect({marks: marks().length, comments: getPlanComments(SESSION).length}).toStrictEqual({
			marks: 0,
			comments: 1,
		});
	});

	it("lights up every segment of the hovered comment", () => {
		addPlanComment(SESSION, {selectedText: "Green\nBlack", startOffset: 31, endOffset: 42, comment: "x"});
		addPlanComment(SESSION, {selectedText: "one", startOffset: 14, endOffset: 17, comment: "y"});
		render(pane(CONTENT));
		fireEvent.mouseOver(markButton("Black"));
		const during = marks().map((mark) => [mark.textContent, mark.className.endsWith(HOVER)]);
		fireEvent.mouseOut(markButton("Black"), {relatedTarget: document.body});

		expect({during, after: marks().map((mark) => mark.className.endsWith(REST))}).toStrictEqual({
			during: [
				["one", false],
				["Green", true],
				["\n", true],
				["Black", true],
			],
			after: [true, true, true, true],
		});
	});

	it("opens the edit popover on a mark click, and Delete removes the comment and its mark", () => {
		addPlanComment(SESSION, {selectedText: "one", startOffset: 14, endOffset: 17, comment: "Two cups"});
		render(pane(CONTENT));
		fireEvent.click(markButton("one"));
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Plan comment"});
		const opened = {
			dialog: dialog() !== null,
			value: textarea.value,
			caret: [textarea.selectionStart, textarea.selectionEnd],
			focused: document.activeElement === textarea,
			highlight: (CSS as {highlights?: HighlightRegistry}).highlights?.has("plan-selection") ?? false,
		};
		fireEvent.click(screen.getByRole("button", {name: "Delete comment"}));

		expect({opened, dialog: dialog(), marks: marks().length, comments: getPlanComments(SESSION)}).toStrictEqual({
			opened: {dialog: true, value: "Two cups", caret: [8, 8], focused: true, highlight: false},
			dialog: null,
			marks: 0,
			comments: [],
		});
	});

	it("saves an edit opened with Enter and returns focus to the mark", () => {
		const id = addPlanComment(SESSION, {selectedText: "one", startOffset: 14, endOffset: 17, comment: "Two"});
		render(pane(CONTENT));
		fireEvent.keyDown(markButton("one"), {key: "Enter"});
		fireEvent.change(screen.getByRole("textbox", {name: "Plan comment"}), {target: {value: "Three"}});
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "Save comment"}));
		});

		expect({
			dialog: dialog(),
			comments: getPlanComments(SESSION).map((comment) => comment.comment),
			focus: document.activeElement === markButton("one"),
			focusId: document.activeElement?.parentElement?.getAttribute("data-plan-comment-id"),
		}).toStrictEqual({dialog: null, comments: ["Three"], focus: true, focusId: id});
	});

	it("closes an unchanged edit on an outside press", () => {
		addPlanComment(SESSION, {selectedText: "one", startOffset: 14, endOffset: 17, comment: "Two"});
		render(pane(CONTENT));
		fireEvent.click(markButton("one"));
		fireEvent.pointerDown(document.body);

		expect(dialog()).toBeNull();
	});
});
