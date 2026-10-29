// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChangesPaneView} from "../src/components/changes/changes-pane";
import {Composer} from "../src/components/composer";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import type {SessionDiffResponse} from "../src/lib/api/session-diff";
import {registerComposer, takeContextChips} from "../src/lib/context-attach";
import {clearDiffComments, getDiffComments, openDiffCommentDraft} from "../src/lib/diff-comments";
import {installLocalStorage} from "./fake-storage";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () => {
	await preloadComposerSurfaces();
});

vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));

const SESSION = "session-alice";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,5 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
+export const loud = (name: string) => greet(name).toUpperCase();
`;

const DIFF: SessionDiffResponse = {
	scope: "uncommitted",
	source: "git",
	stats: {files: 1, additions: 3, deletions: 1},
	files: [
		{
			path: "src/greet.ts",
			status: "modified",
			additions: 3,
			deletions: 1,
			binary: false,
			patchLineCount: 10,
			patch: PATCH,
		},
	],
};

class SilentObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", SilentObserver);
	vi.stubGlobal("IntersectionObserver", SilentObserver);
});

afterEach(() => {
	cleanup();
	clearDiffComments(SESSION);
	vi.unstubAllGlobals();
});

function renderPane(onSend: (prompt: string) => void = () => {}) {
	return render(
		<SettingsProvider>
			<ToastProvider>
				<ChangesPaneView
					diff={DIFF}
					scopes={undefined}
					controls={null}
					onRefresh={() => {}}
					scope="uncommitted"
					sessionId={SESSION}
				/>
				<Composer variant="session" draftKey={SESSION} onSend={onSend} />
			</ToastProvider>
		</SettingsProvider>,
	);
}

function commentCard(container: HTMLElement, slot: string): HTMLElement | null {
	return container.querySelector<HTMLElement>(`[slot="${slot}"] [data-line-comment]`);
}

describe("Changes pane line comments", () => {
	it("opens a comment card under the line and removes it on Escape while empty", () => {
		const {container} = renderPane();
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 3});
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		const textarea = within(card).getByRole("textbox", {name: "Comment on line 3"});
		const opened = {
			label: within(card).getByText("Line 3").textContent,
			placeholder: textarea.getAttribute("placeholder"),
			saveDisabled: within(card).getByRole<HTMLButtonElement>("button", {name: "Save comment"}).disabled,
		};

		fireEvent.keyDown(textarea, {key: "Escape"});

		expect({
			opened,
			card: commentCard(container, "annotation-additions-3"),
			comments: getDiffComments(SESSION),
		}).toStrictEqual({
			opened: {label: "Line 3", placeholder: "Tell Claude what to change", saveDisabled: true},
			card: null,
			comments: {drafts: [], queued: []},
		});
	});

	it("discards a card with text on Escape", () => {
		const {container} = renderPane();
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 3});
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		const textarea = within(card).getByPlaceholderText("Tell Claude what to change");
		fireEvent.change(textarea, {target: {value: "Use a constant"}});
		fireEvent.keyDown(textarea, {key: "Escape"});

		expect({
			card: commentCard(container, "annotation-additions-3"),
			comments: getDiffComments(SESSION),
		}).toStrictEqual({card: null, comments: {drafts: [], queued: []}});
	});

	it("saves on Enter and focuses the composer", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const {container} = renderPane(onSend);
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 2, endLine: 3});
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		const textarea = within(card).getByRole("textbox", {name: "Comment on lines 2–3"});
		fireEvent.change(textarea, {target: {value: "Extract a helper"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			queued: getDiffComments(SESSION).queued.map(({text}) => text),
			drafts: getDiffComments(SESSION).drafts,
			focused: document.activeElement === screen.getByRole("textbox", {name: "Prompt"}),
			sent: onSend.mock.calls,
		}).toStrictEqual({queued: ["Extract a helper"], drafts: [], focused: true, sent: []});
	});

	it("saves and sends the prompt on Meta+Enter", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const {container} = renderPane(onSend);
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 2, endLine: 3});
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		const textarea = within(card).getByRole("textbox", {name: "Comment on lines 2–3"});
		fireEvent.change(textarea, {target: {value: "Extract a helper"}});
		fireEvent.keyDown(textarea, {key: "Enter", metaKey: true});

		expect({sent: onSend.mock.calls, comments: getDiffComments(SESSION)}).toStrictEqual({
			sent: [["src/greet.ts:2-3 — Extract a helper", {}]],
			comments: {drafts: [], queued: []},
		});
	});

	it("discards an empty draft when focus leaves the card", () => {
		vi.useFakeTimers({toFake: ["requestAnimationFrame", "cancelAnimationFrame"]});
		try {
			const {container} = renderPane();
			act(() => {
				openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 3});
			});
			const card = commentCard(container, "annotation-additions-3");
			if (card === null) throw new Error("no comment card");
			fireEvent.blur(within(card).getByRole("textbox", {name: "Comment on line 3"}), {
				relatedTarget: document.body,
			});
			const beforeFrame = getDiffComments(SESSION).drafts.length;
			act(() => {
				vi.advanceTimersByTime(16);
			});

			expect({
				beforeFrame,
				card: commentCard(container, "annotation-additions-3"),
				comments: getDiffComments(SESSION),
			}).toStrictEqual({beforeFrame: 1, card: null, comments: {drafts: [], queued: []}});
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps draft text when the card unmounts and remounts", () => {
		const first = renderPane();
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 3});
		});
		const card = commentCard(first.container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		fireEvent.change(within(card).getByRole("textbox", {name: "Comment on line 3"}), {
			target: {value: "abc"},
		});
		first.unmount();

		const second = renderPane();
		const remounted = commentCard(second.container, "annotation-additions-3");
		if (remounted === null) throw new Error("no comment card after remount");

		expect(within(remounted).getByRole<HTMLTextAreaElement>("textbox", {name: "Comment on line 3"}).value).toBe(
			"abc",
		);
	});

	it("queues saved comments as chips and prepends them to the next prompt", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const {container} = renderPane(onSend);
		act(() => {
			openDiffCommentDraft(SESSION, {
				path: "src/greet.ts",
				side: "additions",
				line: 2,
				endLine: 3,
			});
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		fireEvent.change(within(card).getByPlaceholderText("Tell Claude what to change"), {
			target: {value: "Extract a helper"},
		});
		fireEvent.click(within(card).getByRole("button", {name: "Save comment"}));

		const chips = screen.getByRole("list", {name: "Attached context"});
		const queued = {
			chips: within(chips)
				.getAllByRole("listitem")
				.map((chip) => chip.textContent),
			saved: container.querySelector('[slot="annotation-additions-3"] [data-saved-comment]')?.textContent,
			sendEnabled: !screen.getByRole<HTMLButtonElement>("button", {name: "Send"}).disabled,
		};

		const prompt = screen.getByRole("textbox", {name: "Prompt"});
		fireEvent.change(prompt, {target: {value: "Please address these"}});
		fireEvent.keyDown(prompt, {key: "Enter"});

		expect({
			queued,
			sent: onSend.mock.calls,
			chipsAfter: screen.queryByRole("list", {name: "Attached context"}),
			comments: getDiffComments(SESSION),
		}).toStrictEqual({
			queued: {
				chips: ["greet.ts:2-3Extract a helper"],
				saved: "Lines 2–3Extract a helper",
				sendEnabled: true,
			},
			sent: [["src/greet.ts:2-3 — Extract a helper\n\nPlease address these", {}]],
			chipsAfter: null,
			comments: {drafts: [], queued: []},
		});
	});

	it("removes a queued comment from its chip", () => {
		renderPane();
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 5});
		});
		const card = document.querySelector<HTMLElement>('[slot="annotation-additions-5"] [data-line-comment]');
		if (card === null) throw new Error("no comment card");
		fireEvent.change(within(card).getByPlaceholderText("Tell Claude what to change"), {
			target: {value: "Rename"},
		});
		fireEvent.click(within(card).getByRole("button", {name: "Save comment"}));
		fireEvent.click(screen.getByRole("button", {name: "Remove comment on greet.ts:5"}));

		expect({
			chips: screen.queryByRole("list", {name: "Attached context"}),
			comments: getDiffComments(SESSION),
		}).toStrictEqual({chips: null, comments: {drafts: [], queued: []}});
	});
});

describe("Changes pane saved comments", () => {
	function saveComment(container: HTMLElement, text: string): HTMLElement {
		act(() => {
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 5});
		});
		const draft = commentCard(container, "annotation-additions-5");
		if (draft === null) throw new Error("no comment card");
		fireEvent.change(within(draft).getByPlaceholderText("Tell Claude what to change"), {target: {value: text}});
		fireEvent.click(within(draft).getByRole("button", {name: "Save comment"}));
		const saved = container.querySelector<HTMLElement>('[slot="annotation-additions-5"] [data-saved-comment]');
		if (saved === null) throw new Error("no saved card");
		return saved;
	}

	function chipTexts(): (string | null)[] {
		const chips = screen.queryByRole("list", {name: "Attached context"});
		return chips === null
			? []
			: within(chips)
					.getAllByRole("listitem")
					.map((chip) => chip.textContent);
	}

	it("renders a saved comment as a clickable card with revealed Edit and Delete", () => {
		const {container} = renderPane();
		const saved = saveComment(container, "Rename");

		expect({
			queuedText: within(saved).queryByText("Queued"),
			body: within(saved).getByRole("button", {name: "Rename"}).textContent,
			edit: within(saved).getByRole("button", {name: "Edit comment"}).classList.contains("opacity-0"),
			remove: within(saved).getByRole("button", {name: "Delete comment"}).classList.contains("opacity-0"),
		}).toStrictEqual({queuedText: null, body: "Rename", edit: true, remove: true});
	});

	it("edits a saved comment from its body and updates the composer chip", () => {
		const {container} = renderPane();
		const saved = saveComment(container, "Rename");
		fireEvent.click(within(saved).getByRole("button", {name: "Rename"}));
		const textarea = within(saved).getByRole<HTMLTextAreaElement>("textbox", {name: "Comment on line 5"});
		const editing = {
			value: textarea.value,
			border: saved.querySelector<HTMLElement>(".group\\/card")?.style.borderColor,
			deleteButton: within(saved).queryByRole("button", {name: "Delete comment"}),
		};
		fireEvent.change(textarea, {target: {value: "Rename it"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			editing,
			chips: chipTexts(),
			queued: getDiffComments(SESSION).queued.map(({text}) => text),
			body: within(saved).getByRole("button", {name: "Rename it"}).textContent,
		}).toStrictEqual({
			editing: {value: "Rename", border: "var(--color-fill-accent)", deleteButton: null},
			chips: ["greet.ts:5Rename it"],
			queued: ["Rename it"],
			body: "Rename it",
		});
	});

	it("restores the saved text on Escape during an edit", () => {
		const {container} = renderPane();
		const saved = saveComment(container, "Rename");
		fireEvent.click(within(saved).getByRole("button", {name: "Edit comment"}));
		const textarea = within(saved).getByRole("textbox", {name: "Comment on line 5"});
		fireEvent.change(textarea, {target: {value: "Something else"}});
		fireEvent.keyDown(textarea, {key: "Escape"});

		expect({
			textbox: within(saved).queryByRole("textbox"),
			body: within(saved).getByRole("button", {name: "Rename"}).textContent,
			queued: getDiffComments(SESSION).queued.map(({text}) => text),
		}).toStrictEqual({textbox: null, body: "Rename", queued: ["Rename"]});
	});

	it("removes the card and chip on Delete comment", () => {
		const {container} = renderPane();
		const saved = saveComment(container, "Rename");
		fireEvent.click(within(saved).getByRole("button", {name: "Delete comment"}));

		expect({
			card: container.querySelector('[slot="annotation-additions-5"] [data-saved-comment]'),
			chips: chipTexts(),
			comments: getDiffComments(SESSION),
		}).toStrictEqual({card: null, chips: [], comments: {drafts: [], queued: []}});
	});

	it("sends the active card's unsaved edit text", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const {container} = renderPane(onSend);
		const saved = saveComment(container, "Rename");
		fireEvent.click(within(saved).getByRole("button", {name: "Rename"}));
		fireEvent.change(within(saved).getByRole("textbox", {name: "Comment on line 5"}), {
			target: {value: "Rename it"},
		});
		const prompt = screen.getByRole("textbox", {name: "Prompt"});
		fireEvent.change(prompt, {target: {value: "Go"}});
		fireEvent.keyDown(prompt, {key: "Enter"});

		expect(onSend.mock.calls).toStrictEqual([["src/greet.ts:5 — Rename it\n\nGo", {}]]);
	});
});

describe("Changes pane right-click menu", () => {
	async function rightClickLine(container: HTMLElement, line: number): Promise<void> {
		const row = await waitFor(() => {
			const root = container.querySelector("diffs-container")?.shadowRoot;
			const found = root?.querySelector(`[data-line-type="change-addition"][data-line="${line}"]`);
			if (!found) throw new Error("diff not rendered yet");
			return found;
		});
		fireEvent.contextMenu(row);
	}

	it("offers Attach as context, Request changes and Copy", async () => {
		const {container} = renderPane();
		await rightClickLine(container, 3);
		const items = await screen.findAllByRole("menuitem");

		expect(
			items.map((item) => [
				item.textContent.replace(/(⌘C|Ctrl\+C)$/, ""),
				item.getAttribute("aria-keyshortcuts"),
			]),
		).toStrictEqual([
			["Attach as context", null],
			["Request changes", null],
			["Copy", "Control+c"],
		]);
	});

	it("attaches the clicked line as @path#L with its code fenced", async () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		const {container} = renderPane();
		await rightClickLine(container, 3);
		fireEvent.click(await screen.findByRole("menuitem", {name: /Attach as context/}));
		stop();

		expect(takeContextChips(SESSION).map(({id: _id, ...chip}) => chip)).toStrictEqual([
			{
				kind: "selection",
				path: "src/greet.ts",
				range: {start: 3, end: 3},
				text: '  return greeting + " " + name;',
				language: "typescript",
			},
		]);
	});

	it("opens a comment card on the clicked line from Request changes", async () => {
		const {container} = renderPane();
		await rightClickLine(container, 3);
		fireEvent.click(await screen.findByRole("menuitem", {name: /Request changes/}));

		expect(getDiffComments(SESSION).drafts.map(({path, side, line}) => ({path, side, line}))).toStrictEqual([
			{path: "src/greet.ts", side: "additions", line: 3},
		]);
		expect(commentCard(container, "annotation-additions-3")).not.toBeNull();
	});
});
