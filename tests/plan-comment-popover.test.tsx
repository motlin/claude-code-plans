// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionPlanPane} from "../src/components/panes/plan-pane";
import {addPlanComment, clearPlanComments, getPlanComments} from "../src/lib/plan-comments";
import type {SessionPlanModel} from "../src/lib/session-plan-model";

const SESSION = "fabricated-popover-session";

afterEach(() => {
	cleanup();
	clearPlanComments(SESSION);
	vi.useRealTimers();
});

const MODEL: SessionPlanModel = {
	content: "# Tea plan\n\nBrew one cup of tea.\n\n```\nboil()\n```\n\nPour it.",
	todos: [],
	editsPlanFile: false,
};

function renderPane(commentsEnabled = true) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	render(
		<QueryClientProvider client={queryClient}>
			<SessionPlanPane
				sessionId={SESSION}
				planFilename={undefined}
				model={MODEL}
				commentsEnabled={commentsEnabled}
			/>
		</QueryClientProvider>,
	);
	return screen.getByTestId("session-plan-pane");
}

function textOf(root: HTMLElement, text: string): Text {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node.textContent?.includes(text) === true && node instanceof Text) return node;
	}
	throw new Error(`no text node with ${text}`);
}

/** Drag-select from `from` in `node` to `to` in `endNode` (default `node`): mousedown inside, the selection moves, then mouseup. */
function dragSelect(node: Text, from: number, to: number, detail = 1, endNode: Text = node) {
	fireEvent.mouseDown(node.parentElement as Element);
	const range = document.createRange();
	range.setStart(node, from);
	range.setEnd(endNode, to);
	const selection = document.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	act(() => {
		document.dispatchEvent(new Event("selectionchange"));
	});
	fireEvent.mouseUp(node.parentElement as Element, {detail});
}

function dialog(): HTMLElement | null {
	return document.querySelector('[role="dialog"][aria-label="Comment on selection"]');
}

describe("plan selection comment popover", () => {
	it("opens upstream's popover under a mouse selection with the textarea focused and Save disabled", () => {
		const pane = renderPane();
		dragSelect(textOf(pane, "Brew one cup"), 0, 4);

		const popover = dialog();
		const textarea = screen.getByRole("textbox", {name: "Plan comment"});
		expect({
			className: popover?.className,
			parent: popover?.parentElement === document.body,
			focused: document.activeElement === textarea,
			placeholder: textarea.getAttribute("placeholder"),
			saveDisabled: screen.getByRole<HTMLButtonElement>("button", {name: "Save comment"}).disabled,
			windowSelectionCleared: document.getSelection()?.rangeCount,
		}).toStrictEqual({
			className:
				"fixed left-0 top-0 isolate z-[90] w-[320px] break-words rounded-r7 bg-surface-3 text-body text-primary outline-none shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_8px_24px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)] dark:shadow-[0_0_0_1px_var(--color-border),0_8px_24px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)] [will-change:transform]",
			parent: true,
			focused: true,
			placeholder: "Add a comment",
			saveDisabled: true,
			windowSelectionCleared: 0,
		});
	});

	it("saves the comment with the selection's flattened offsets", () => {
		const pane = renderPane();
		dragSelect(textOf(pane, "Brew one cup"), 5, 8);
		fireEvent.change(screen.getByRole("textbox", {name: "Plan comment"}), {target: {value: " Two cups "}});
		fireEvent.click(screen.getByRole("button", {name: "Save comment"}));

		expect({
			comments: getPlanComments(SESSION).map(({id: _id, ...comment}) => comment),
			open: dialog(),
		}).toStrictEqual({
			// "Tea plan" and the newline after its heading (9) precede the paragraph in the flattened text.
			comments: [{selectedText: "one", startOffset: 14, endOffset: 17, comment: "Two cups"}],
			open: null,
		});
	});

	it("opens nothing for a selection inside a code block", () => {
		const pane = renderPane();
		dragSelect(textOf(pane, "boil()"), 0, 4);

		expect(dialog()).toBeNull();
	});

	it("opens nothing for a selection overlapping an existing comment", () => {
		addPlanComment(SESSION, {selectedText: "cup", startOffset: 18, endOffset: 21, comment: "x"});
		const pane = renderPane();
		// The comment's mark splits the paragraph into "Brew one ", "cup" and " of tea.".
		dragSelect(textOf(pane, "Brew one"), 5, 2, 1, textOf(pane, "cup"));
		const overlapping = dialog();
		dragSelect(textOf(pane, "Brew one"), 0, 9);

		expect({overlapping, adjacent: dialog() !== null}).toStrictEqual({overlapping: null, adjacent: true});
	});

	it("opens nothing when comments are disabled", () => {
		const pane = renderPane(false);
		dragSelect(textOf(pane, "Brew one cup"), 0, 4);

		expect(dialog()).toBeNull();
	});

	it("waits 250ms after a double click before opening", () => {
		vi.useFakeTimers();
		const pane = renderPane();
		dragSelect(textOf(pane, "Brew one cup"), 0, 4, 2);
		const before = dialog();
		act(() => {
			vi.advanceTimersByTime(250);
		});

		expect({before, after: dialog() !== null}).toStrictEqual({before: null, after: true});
	});

	it("keeps a dirty popover open on an outside press and closes a blank one", () => {
		const pane = renderPane();
		dragSelect(textOf(pane, "Brew one cup"), 0, 4);
		fireEvent.change(screen.getByRole("textbox", {name: "Plan comment"}), {target: {value: "draft"}});
		fireEvent.pointerDown(document.body);
		const dirtyOpen = dialog() !== null;
		fireEvent.change(screen.getByRole("textbox", {name: "Plan comment"}), {target: {value: "  "}});
		fireEvent.pointerDown(document.body);

		expect({dirtyOpen, blankOpen: dialog() !== null}).toStrictEqual({dirtyOpen: true, blankOpen: false});
	});

	it("closes on Escape without saving", () => {
		const pane = renderPane();
		dragSelect(textOf(pane, "Brew one cup"), 0, 4);
		fireEvent.keyDown(screen.getByRole("textbox", {name: "Plan comment"}), {key: "Escape"});

		expect({open: dialog(), comments: getPlanComments(SESSION)}).toStrictEqual({open: null, comments: []});
	});

	it("does not reopen over a dirty popover on a new selection", () => {
		const pane = renderPane();
		dragSelect(textOf(pane, "Brew one cup"), 0, 4);
		fireEvent.change(screen.getByRole("textbox", {name: "Plan comment"}), {target: {value: "draft"}});
		dragSelect(textOf(pane, "Pour it"), 0, 4);

		expect(screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Plan comment"}).value).toBe("draft");
	});
});
