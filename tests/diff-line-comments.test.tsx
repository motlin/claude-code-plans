// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChangesPaneView} from "../src/components/changes/changes-pane";
import {diffSideSnippet} from "../src/components/changes/diff-annotations";
import {AddCommentGutterButton} from "../src/components/changes/diff-file";
import {Composer} from "../src/components/composer";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../src/components/ui/menu";
import type {SessionDiffResponse} from "../src/lib/api/session-diff";
import {registerComposer, takeContextChips} from "../src/lib/context-attach";
import {clearDiffComments, getDiffComments, openDiffCommentDraft, saveDiffComment} from "../src/lib/diff-comments";
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
	root: "/repo",
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

function renderPane(onSend: (prompt: string) => void = () => {}, extra: ReactNode = null) {
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
					cwd="/repo"
				/>
				<Composer variant="session" draftKey={SESSION} onSend={onSend} />
				{extra}
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
			sent: [["In `src/greet.ts` at lines 2-3:\nExtract a helper", {}]],
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
			sent: [["In `src/greet.ts` at lines 2-3:\nExtract a helper\n\n\nPlease address these", {}]],
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

		expect(onSend.mock.calls).toStrictEqual([["In `src/greet.ts` at line 5:\nRename it\n\n\nGo", {}]]);
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

	function rightClickHeader(container: HTMLElement): void {
		const header = container.querySelector('[data-diff-file-header="src/greet.ts"] button[aria-expanded]');
		if (!(header instanceof HTMLElement)) throw new Error("no header");
		// A real right-click's pointerdown focuses the button first.
		header.focus();
		fireEvent.contextMenu(header, {clientX: 10, clientY: 10});
	}

	function menuRows(menu: HTMLElement): string[] {
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	it("opens the file menu, not the line menu, on a file header right-click", async () => {
		const {container} = renderPane();
		rightClickHeader(container);
		const menus = await waitFor(() => {
			const open = screen.getAllByRole("menu");
			if (open.length === 0) throw new Error("no menu");
			return open;
		});

		expect(menus.map(menuRows)).toStrictEqual([["Attach as context", "Copy", "─", "Open in", "Show in Finder"]]);
	});

	it("focuses the file menu's popup on open and the header button after Escape", async () => {
		const {container} = renderPane();
		rightClickHeader(container);
		const menu = await screen.findByRole("menu");
		await waitFor(() => {
			if (document.activeElement !== menu) throw new Error("popup not focused");
		});
		const popupFocused = document.activeElement === menu;
		fireEvent.keyDown(menu, {key: "Escape"});

		await waitFor(() => {
			expect({
				popupFocused,
				focused: document.activeElement
					?.closest("[data-diff-file-header]")
					?.getAttribute("data-diff-file-header"),
				expanded: document.activeElement?.hasAttribute("aria-expanded"),
			}).toStrictEqual({popupFocused: true, focused: "src/greet.ts", expanded: true});
		});
	});

	it("attaches the file as a cwd-relative mention from the file menu", async () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		const {container} = renderPane();
		rightClickHeader(container);
		fireEvent.click(await screen.findByRole("menuitem", {name: "Attach as context"}));
		stop();

		expect(takeContextChips(SESSION).map(({id: _id, ...chip}) => chip)).toStrictEqual([
			{kind: "file", path: "src/greet.ts"},
		]);
	});

	it("says to open the chat input when the file can't be attached", async () => {
		const {container} = render(
			<SettingsProvider>
				<ToastProvider>
					<ChangesPaneView
						diff={DIFF}
						scopes={undefined}
						controls={null}
						onRefresh={() => {}}
						sessionId={SESSION}
						cwd="/repo"
					/>
				</ToastProvider>
			</SettingsProvider>,
		);
		rightClickHeader(container);
		fireEvent.click(await screen.findByRole("menuitem", {name: "Attach as context"}));

		expect(await screen.findByText("Open the chat input to attach context.")).toBeTruthy();
	});

	it("offers Attach as context, Add comment, a separator and Copy", async () => {
		const {container} = renderPane();
		await rightClickLine(container, 3);
		const menu = await screen.findByRole("menu");

		expect(
			[...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((item) => [
				item.getAttribute("role"),
				item.textContent.replace(/(⌘C|Ctrl\+C)$/, ""),
				item.getAttribute("aria-label"),
				item.getAttribute("aria-keyshortcuts"),
			]),
		).toStrictEqual([
			["menuitem", "Attach as context", null, null],
			["menuitem", "Add comment", "Add comment on line 3", null],
			["separator", "", null, null],
			["menuitem", "Copy", null, "Control+c"],
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

	it("opens a comment card on the clicked line from Add comment", async () => {
		const {container} = renderPane();
		await rightClickLine(container, 3);
		fireEvent.click(await screen.findByRole("menuitem", {name: "Add comment on line 3"}));

		expect(getDiffComments(SESSION).drafts.map(({id: _id, ...draft}) => draft)).toStrictEqual([
			{
				path: "src/greet.ts",
				side: "additions",
				line: 3,
				snippet: '  return greeting + " " + name;',
				lang: "typescript",
			},
		]);
		expect(commentCard(container, "annotation-additions-3")).not.toBeNull();
	});

	it("focuses the new card's textarea after Add comment, not the menu's trigger", async () => {
		const {container} = renderPane();
		await rightClickLine(container, 3);
		fireEvent.click(await screen.findByRole("menuitem", {name: "Add comment on line 3"}));

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 50);
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		expect(document.activeElement).toBe(within(card).getByRole("textbox", {name: "Comment on line 3"}));
	});
});

describe("Changes pane selection Add comment chip", () => {
	type RowType = "change-addition" | "change-deletion";

	/** The rendered diff's shadow root and its `diffs-container` host. */
	async function diffRoot(container: HTMLElement): Promise<ShadowRoot> {
		return waitFor(() => {
			const found = container.querySelector("diffs-container")?.shadowRoot;
			if (!found?.querySelector('[data-line-type="change-addition"][data-line="3"]'))
				throw new Error("diff not rendered yet");
			return found;
		});
	}

	function rowAt(root: ShadowRoot, type: RowType, line: number, column?: "deletions" | "additions"): Element {
		const scope = column === undefined ? "" : `[data-${column}] `;
		const found = root.querySelector(`${scope}[data-line-type="${type}"][data-line="${line}"]`);
		if (found === null) throw new Error(`no ${type} row ${line}`);
		return found;
	}

	/**
	 * Stands in for Chrome's ShadowRoot.getSelection over the diff, from `anchor` to `focus`.
	 * `select` moves it, as a keyboard Shift+Arrow or a programmatic change would.
	 */
	function fakeSelection(root: ShadowRoot, anchor: Element, focus: Element) {
		let clears = 0;
		let collapsed = false;
		let ends = {anchor, focus};
		const range = {
			get commonAncestorContainer() {
				return ends.anchor.parentNode;
			},
			getBoundingClientRect: () => new DOMRect(100, 200, 60, 40),
			getClientRects: () => [new DOMRect(100, 200, 60, 20)],
		};
		const selection = {
			get rangeCount() {
				return collapsed ? 0 : 1;
			},
			get isCollapsed() {
				return collapsed;
			},
			get anchorNode() {
				return ends.anchor.firstChild;
			},
			get focusNode() {
				return ends.focus.firstChild;
			},
			getRangeAt: () => range,
			removeAllRanges: () => {
				clears += 1;
				collapsed = true;
			},
		};
		Object.defineProperty(root, "getSelection", {configurable: true, value: () => selection});
		return {
			cleared: () => clears,
			select: (nextAnchor: Element, nextFocus: Element) => {
				ends = {anchor: nextAnchor, focus: nextFocus};
				act(() => {
					document.dispatchEvent(new Event("selectionchange"));
				});
			},
		};
	}

	/** Selects addition lines 2-3 inside the diff's shadow root. */
	async function selectLines(container: HTMLElement) {
		const root = await diffRoot(container);
		const row = rowAt(root, "change-addition", 3);
		return {root, row, ...fakeSelection(root, rowAt(root, "change-addition", 2), row)};
	}

	function mockRect(element: Element, rect: () => DOMRect): void {
		Object.defineProperty(element, "getBoundingClientRect", {configurable: true, value: rect});
	}

	/** The per-file chip wrapper the mouse-up lands on (the context-menu trigger). */
	function chipWrapper(container: HTMLElement): HTMLElement {
		let element = container.querySelector("diffs-container")?.parentElement ?? null;
		while (element !== null && element.className !== "relative") element = element.parentElement;
		if (element === null) throw new Error("no chip wrapper");
		return element;
	}

	function chipHost(chip: HTMLElement): HTMLElement {
		const host = chip.closest<HTMLElement>("[data-pane-editor]");
		if (host === null) throw new Error("no chip host");
		return host;
	}

	const CHIP = {name: "Add comment on lines 2–3"};

	it("floats upstream's Add comment chip over a diff selection and opens a card on its lines", async () => {
		const {container} = renderPane();
		const {row, cleared} = await selectLines(container);
		fireEvent.mouseUp(row, {clientY: 200});
		const chip = await screen.findByRole("button", CHIP);
		const host = chipHost(chip);
		const shown = {
			text: chip.textContent,
			hostClass: host.className,
			transform: host.style.transform,
			zIndex: host.style.zIndex,
		};

		fireEvent.mouseDown(chip);
		fireEvent.mouseUp(chip);
		fireEvent.click(chip);

		expect({
			shown,
			drafts: getDiffComments(SESSION).drafts.map(({path, side, line, endLine}) => ({path, side, line, endLine})),
			cleared: cleared(),
			chip: screen.queryByRole("button", CHIP),
		}).toStrictEqual({
			shown: {
				text: "Add comment",
				hostClass: "absolute isolate",
				transform: "translate(-50%, calc(-100% - 8px))",
				zIndex: "4",
			},
			drafts: [{path: "src/greet.ts", side: "additions", line: 2, endLine: 3}],
			cleared: 1,
			chip: null,
		});
	});

	it("hides the chip when the diff body's context menu opens", async () => {
		const {container} = renderPane();
		const {row} = await selectLines(container);
		fireEvent.mouseUp(row);
		await screen.findByRole("button", CHIP);

		fireEvent.contextMenu(row);

		expect({
			chip: screen.queryByRole("button", CHIP),
			menuItem: (await screen.findByRole("menuitem", CHIP)).textContent,
		}).toStrictEqual({chip: null, menuItem: "Add comment"});
	});

	it("anchors the chip to the pointer, clamped 72px inside the wrapper, and flips below near the scroller's top", async () => {
		const {container} = renderPane();
		const {row} = await selectLines(container);
		mockRect(chipWrapper(container), () => new DOMRect(0, 0, 400, 600));
		const place = (init: {clientX: number; clientY: number}) => {
			fireEvent.mouseUp(row, init);
			const host = chipHost(screen.getByRole("button", CHIP));
			return {left: host.style.left, top: host.style.top, transform: host.style.transform};
		};
		const left = place({clientX: 10, clientY: 200});
		const right = place({clientX: 390, clientY: 200});
		const scroller = container.querySelector("diffs-container")?.closest<HTMLElement>('[class*="overflow-y-auto"]');
		if (!scroller) throw new Error("no scroller");
		scroller.style.overflowY = "auto";
		mockRect(scroller, () => new DOMRect(0, 180, 400, 400));
		const flipped = place({clientX: 200, clientY: 200});

		expect({left, right, flipped}).toStrictEqual({
			left: {left: "72px", top: "200px", transform: "translate(-50%, calc(-100% - 8px))"},
			right: {left: "328px", top: "200px", transform: "translate(-50%, calc(-100% - 8px))"},
			flipped: {left: "200px", top: "200px", transform: "translate(-50%, 8px)"},
		});
	});

	it("leaves the chip alone on a non-primary mouse-up or a mouse-up on the file header", async () => {
		const {container} = renderPane();
		const {row, root} = await selectLines(container);
		fireEvent.mouseUp(row);
		await screen.findByRole("button", CHIP);
		const header = container.querySelector("[data-diff-file-header]");
		if (header === null) throw new Error("no header");
		// A different selection the gated mouse-ups must not pick up.
		const other = rowAt(root, "change-addition", 5);
		Object.defineProperty(root, "getSelection", {
			configurable: true,
			value: () => ({
				rangeCount: 1,
				isCollapsed: false,
				anchorNode: other.firstChild,
				focusNode: other.firstChild,
				getRangeAt: () => ({commonAncestorContainer: other.parentNode}),
			}),
		});

		fireEvent.mouseUp(row, {button: 2});
		const afterSecondary = screen.queryByRole("button", CHIP) !== null;
		fireEvent.mouseUp(header);
		const afterHeader = screen.queryByRole("button", CHIP) !== null;

		expect({afterSecondary, afterHeader}).toStrictEqual({afterSecondary: true, afterHeader: true});
	});

	it("waits 250ms after a double or triple click, and a wheel or a moved host cancels it", async () => {
		const {container} = renderPane();
		const {row} = await selectLines(container);
		const diffHost = container.querySelector("diffs-container");
		if (diffHost === null) throw new Error("no diff host");
		let hostTop = 0;
		mockRect(diffHost, () => new DOMRect(0, hostTop, 400, 300));
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		try {
			const visible = () => screen.queryByRole("button", CHIP) !== null;
			fireEvent.mouseUp(row, {detail: 2});
			const atStart = visible();
			act(() => {
				vi.advanceTimersByTime(249);
			});
			const at249 = visible();
			act(() => {
				vi.advanceTimersByTime(1);
			});
			const at250 = visible();
			act(() => {
				document.dispatchEvent(new Event("selectionchange"));
			});

			fireEvent.contextMenu(row);
			fireEvent.mouseUp(row, {detail: 3});
			fireEvent.wheel(document);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const afterWheel = visible();

			fireEvent.mouseUp(row, {detail: 2});
			hostTop = 40;
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const afterMove = visible();

			expect({atStart, at249, at250, afterWheel, afterMove}).toStrictEqual({
				atStart: false,
				at249: false,
				at250: true,
				afterWheel: false,
				afterMove: false,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("takes the addition rows of a unified selection that spans deletions and additions", async () => {
		const {container} = renderPane();
		const root = await diffRoot(container);
		const row = rowAt(root, "change-deletion", 2);
		fakeSelection(root, rowAt(root, "change-addition", 3), row);
		fireEvent.mouseUp(row);
		// The library paints addition 2 ahead of deletion 2, so this selection covers deletion 2 and addition 3.
		fireEvent.click(await screen.findByRole("button", {name: "Add comment on line 3"}));

		expect(getDiffComments(SESSION).drafts.map(({side, line, endLine}) => ({side, line, endLine}))).toStrictEqual([
			{side: "additions", line: 3, endLine: undefined},
		]);
	});

	it("shows no chip for a split selection across both columns", async () => {
		localStorage.setItem("ccp-diff-style", "split");
		class WideObserver {
			constructor(private readonly callback: ResizeObserverCallback) {}
			observe(target: Element) {
				this.callback(
					[
						{
							target,
							contentRect: new DOMRect(0, 0, 900, 600),
							borderBoxSize: [{inlineSize: 900, blockSize: 600}],
							contentBoxSize: [{inlineSize: 900, blockSize: 600}],
						} as unknown as ResizeObserverEntry,
					],
					this,
				);
			}
			unobserve() {}
			disconnect() {}
		}
		vi.stubGlobal("ResizeObserver", WideObserver);
		const {container} = renderPane();
		const root = await waitFor(() => {
			const found = container.querySelector("diffs-container")?.shadowRoot;
			if (!found?.querySelector("[data-additions] [data-line]")) throw new Error("split diff not rendered yet");
			return found;
		});
		const focus = rowAt(root, "change-addition", 3, "additions");
		fakeSelection(root, rowAt(root, "change-deletion", 2, "deletions"), focus);
		fireEvent.mouseUp(focus);
		const across = screen.queryByRole("button", {name: /^Add comment on lines? \d/});
		fakeSelection(root, rowAt(root, "change-addition", 2, "additions"), focus);
		fireEvent.mouseUp(focus);

		expect({
			across,
			oneColumn: (await screen.findByRole("button", {name: /^Add comment on lines? \d/})).getAttribute(
				"aria-label",
			),
		}).toStrictEqual({across: null, oneColumn: "Add comment on lines 2–3"});
	});

	it("hides on a selection moved to other lines but keeps it for the same lines", async () => {
		const {container} = renderPane();
		const {row, root, select} = await selectLines(container);
		fireEvent.mouseUp(row);
		await screen.findByRole("button", CHIP);

		select(rowAt(root, "change-addition", 3), rowAt(root, "change-addition", 2));
		const sameLines = screen.queryByRole("button", CHIP) !== null;
		select(rowAt(root, "change-addition", 2), rowAt(root, "change-addition", 5));
		const otherLines = screen.queryByRole("button", {name: /^Add comment on lines? \d/}) !== null;

		expect({sameLines, otherLines}).toStrictEqual({sameLines: true, otherLines: false});
	});

	it("hides on Escape (claiming it) but not while typing in a field, and keeps the text selection", async () => {
		const {container} = renderPane();
		const {row, cleared} = await selectLines(container);
		fireEvent.mouseUp(row);
		await screen.findByRole("button", CHIP);
		const field = document.createElement("textarea");
		document.body.append(field);
		field.focus();

		const fieldEscapeNotCanceled = fireEvent.keyDown(field, {key: "Escape"});
		const afterField = screen.queryByRole("button", CHIP) !== null;
		field.remove();
		const escapeNotCanceled = fireEvent.keyDown(document.body, {key: "Escape"});

		expect({
			fieldEscapeNotCanceled,
			afterField,
			escapeNotCanceled,
			afterEscape: screen.queryByRole("button", CHIP),
			cleared: cleared(),
		}).toStrictEqual({
			fieldEscapeNotCanceled: true,
			afterField: true,
			escapeNotCanceled: false,
			afterEscape: null,
			cleared: 0,
		});
	});

	it("hides on a wheel, and on a scroll that moves the diff host", async () => {
		const {container} = renderPane();
		const {row} = await selectLines(container);
		const diffHost = container.querySelector("diffs-container");
		if (diffHost === null) throw new Error("no diff host");
		let hostTop = 0;
		mockRect(diffHost, () => new DOMRect(0, hostTop, 400, 300));

		fireEvent.mouseUp(row);
		await screen.findByRole("button", CHIP);
		fireEvent.wheel(document);
		const afterWheel = screen.queryByRole("button", CHIP) !== null;

		fireEvent.mouseUp(row);
		await screen.findByRole("button", CHIP);
		fireEvent.scroll(window);
		const afterStillScroll = screen.queryByRole("button", CHIP) !== null;
		hostTop = 30;
		fireEvent.scroll(window);
		const afterMovingScroll = screen.queryByRole("button", CHIP) !== null;

		expect({afterWheel, afterStillScroll, afterMovingScroll}).toStrictEqual({
			afterWheel: false,
			afterStillScroll: true,
			afterMovingScroll: false,
		});
	});

	it("hides the chip surface while another menu is open, keeping it mounted", async () => {
		const {container} = renderPane(
			() => {},
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<MenuItem>Rename</MenuItem>
				</MenuContent>
			</Menu>,
		);
		const {row} = await selectLines(container);
		fireEvent.mouseUp(row);
		const surface = (await screen.findByRole("button", CHIP)).closest<HTMLElement>('[data-surface="popover"]');
		const state = () => ({mounted: surface?.isConnected, visibility: surface?.style.visibility});
		const before = state();

		fireEvent.click(screen.getByRole("button", {name: "More options"}));
		await screen.findByRole("menuitem", {name: "Rename"});
		const whileOpen = state();
		fireEvent.keyDown(screen.getByRole("menuitem", {name: "Rename"}), {key: "Escape"});
		await waitFor(() => {
			if (screen.queryByRole("menuitem", {name: "Rename"}) !== null) throw new Error("menu still open");
		});

		expect({before, whileOpen, after: state()}).toStrictEqual({
			before: {mounted: true, visibility: ""},
			whileOpen: {mounted: true, visibility: "hidden"},
			after: {mounted: true, visibility: ""},
		});
	});

	it("renders upstream's cds ghost Button with its paint layer and label, following the density scope", async () => {
		const {container} = renderPane();
		const {row} = await selectLines(container);
		fireEvent.mouseUp(row);
		const chip = await screen.findByRole("button", CHIP);
		const paintLayer = chip.firstElementChild;
		const paint = paintLayer?.firstElementChild;
		const label = chip.lastElementChild;

		expect({
			cds: chip.getAttribute("data-cds"),
			ghost: chip.hasAttribute("data-cds-ghost"),
			button: chip.className,
			surface: chip.closest('[data-surface="popover"]')?.className,
			paintLayer: [paintLayer?.getAttribute("aria-hidden"), paintLayer?.className],
			paint: [paint?.getAttribute("data-cds-part"), paint?.className],
			label: [label?.tagName, label?.className, label?.textContent],
		}).toStrictEqual({
			cds: "Button",
			ghost: true,
			button: "group/btn relative isolate inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-r5 px-2 text-body font-control-regular text-primary select-none outline-none focus-visible:shadow-focus comfortable:h-7 comfortable:px-3 comfortable:rounded-r6",
			surface:
				"rounded-r5 bg-surface-3 shadow-[var(--menu-shadow)] forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] group/split flex comfortable:rounded-r6",
			paintLayer: ["true", "absolute -z-[1] rounded-[inherit] inset-0"],
			paint: [
				"paint",
				"absolute inset-0 rounded-[inherit] bg-transparent transition-[box-shadow,color] duration-[60ms] ease-[cubic-bezier(.165,.84,.44,1)] group-hover/btn:bg-fill-button-ghost-hover group-focus-visible/btn:shadow-[inset_0_0_0_1px_var(--cds-page-bg)]",
			],
			label: ["SPAN", "inline-flex min-w-0 items-center gap-1", "Add comment"],
		});
	});
});

describe("Changes pane gutter add-comment button", () => {
	it("renders upstream's accent + with no title", () => {
		render(<AddCommentGutterButton getHoveredLine={() => undefined} onAddComment={() => {}} />);
		const button = screen.getByRole("button", {name: "Add comment on this line"});

		expect({
			title: button.getAttribute("title"),
			className: button.className,
			position: button.style.position,
			left: button.style.left,
			top: button.style.top,
			bottom: button.style.bottom,
		}).toStrictEqual({
			title: null,
			className:
				"flex size-4 cursor-pointer items-center justify-center rounded bg-fill-accent text-on-accent hover:bg-fill-accent-hover",
			position: "absolute",
			left: "",
			top: "calc((var(--diffs-line-height, 1lh) - 1rem) / 2)",
			bottom: "auto",
		});
	});

	it("focuses the new card's textarea after a click on +", async () => {
		const {container} = renderPane();
		const host = await waitFor(() => {
			const found = container.querySelector("diffs-container");
			if (!found?.shadowRoot?.querySelector('[data-line-type="change-addition"]'))
				throw new Error("diff not rendered yet");
			return found;
		});
		const plus = host.querySelector<HTMLButtonElement>('button[aria-label="Add comment on this line"]');
		if (plus === null) throw new Error("no gutter button");
		act(() => {
			// The library resolves the hovered line from the pointer; stand in for it with the draft the click opens.
			plus.focus();
			openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 3});
		});

		await new Promise((resolve) => {
			setTimeout(resolve, 50);
		});
		const card = commentCard(container, "annotation-additions-3");
		if (card === null) throw new Error("no comment card");
		expect(document.activeElement).toBe(within(card).getByRole("textbox", {name: "Comment on line 3"}));
	});
});

describe("diffSideSnippet", () => {
	it("returns a side's lines in the range without their diff markers, or undefined outside the diff", () => {
		expect({
			additions: diffSideSnippet(PATCH, "additions", 2, 3),
			deletions: diffSideSnippet(PATCH, "deletions", 2, 2),
			context: diffSideSnippet(PATCH, "deletions", 1, 3),
			outside: diffSideSnippet(PATCH, "additions", 40, 40),
		}).toStrictEqual({
			additions: '  const greeting = "hello";\n  return greeting + " " + name;',
			deletions: '  return "hi " + name;',
			context: 'export function greet(name: string) {\n  return "hi " + name;\n}',
			outside: undefined,
		});
	});
});

describe("Changes pane outdated comments", () => {
	it("labels a comment whose line left the diff Outdated and anchors it to the last line", () => {
		const id = openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 40});
		saveDiffComment(SESSION, id, "Was here");
		const {container} = renderPane();
		const saved = container.querySelector<HTMLElement>('[slot="annotation-additions-5"] [data-saved-comment]');
		if (saved === null) throw new Error("no saved card");
		const badge = within(saved).getByText("Outdated");
		const label = badge.parentElement;

		expect({
			label: label?.className,
			labelText: label?.textContent,
			badge: badge.className,
		}).toStrictEqual({
			label: "flex items-center gap-1.5",
			labelText: "Line 40Outdated",
			badge: "inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-[4.5px] bg-fill-ghost-hover px-1.5 font-sans text-[11px] leading-[14px] font-medium text-secondary",
		});
	});

	it("shows no Outdated badge on a comment whose line is in the diff", () => {
		const id = openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 5});
		saveDiffComment(SESSION, id, "Still here");
		const {container} = renderPane();
		const saved = container.querySelector<HTMLElement>('[slot="annotation-additions-5"] [data-saved-comment]');
		if (saved === null) throw new Error("no saved card");

		expect(within(saved).queryByText("Outdated")).toBeNull();
	});
});
