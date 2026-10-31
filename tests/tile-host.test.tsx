// @vitest-environment jsdom

import {readFileSync} from "node:fs";

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {usePaneHost} from "../src/components/panes/pane-host-context";
import {TileHost} from "../src/components/panes/tile-host";
import {PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";

class FakeStorage implements Storage {
	readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function ChatContent() {
	const host = usePaneHost();
	return (
		<button
			type="button"
			onClick={() => {
				host.openPane("plan");
			}}
		>
			Open test pane
		</button>
	);
}

function renderHost(sessionId: string, onExpandWithoutPane = vi.fn<() => void>()) {
	return render(
		<TileHost sessionId={sessionId} onExpandWithoutPane={onExpandWithoutPane}>
			<ChatContent />
		</TileHost>,
	);
}

function openTestPane() {
	fireEvent.click(screen.getByRole("button", {name: "Open test pane"}));
}

function press(init: KeyboardEventInit) {
	act(() => {
		document.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, ...init}));
	});
}

function separatorState() {
	const separator = screen.getByRole("separator");
	return {
		label: separator.getAttribute("aria-label"),
		orientation: separator.getAttribute("aria-orientation"),
		now: separator.getAttribute("aria-valuenow"),
		min: separator.getAttribute("aria-valuemin"),
		max: separator.getAttribute("aria-valuemax"),
	};
}

let unregister: () => void = () => {};

/** jsdom implements neither pointer capture nor, having no layout, `elementFromPoint`. */
const UNIMPLEMENTED_POINTER_APIS = ["setPointerCapture", "releasePointerCapture"] as const;

function stubElementFromPoint(element: Element | null) {
	Object.defineProperty(document, "elementFromPoint", {configurable: true, value: () => element});
}

beforeEach(() => {
	for (const name of UNIMPLEMENTED_POINTER_APIS) {
		Object.defineProperty(Element.prototype, name, {configurable: true, value: () => {}});
	}
	vi.stubGlobal("localStorage", new FakeStorage());
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
	unregister = registerPane("plan", {
		title: "Test pane",
		render: () => <p>Test pane body</p>,
	});
});

afterEach(() => {
	Reflect.deleteProperty(document, "elementFromPoint");
	for (const name of UNIMPLEMENTED_POINTER_APIS) Reflect.deleteProperty(Element.prototype, name);
	unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("TileHost", () => {
	it("marks an opened pane with the upstream side_pane region and its kind as the screen", () => {
		renderHost("session-a");
		openTestPane();

		const root = screen.getByText("Test pane body").closest("[data-pane-root]");
		expect({
			region: root?.getAttribute("data-perf-region"),
			screen: root?.getAttribute("data-perf-screen"),
		}).toStrictEqual({region: "side_pane", screen: "plan"});
	});

	it("enters upstream's flat line mode once a pane opens: no radius or shadow, primary-ink header buttons", () => {
		renderHost("session-a");
		expect(document.querySelector("[data-tiles-line]")).toBeNull();
		openTestPane();

		const root = screen.getByText("Test pane body").closest("section[data-pane-root]");
		const classesOf = (name: string) => screen.getByRole("button", {name}).className.split(" ");
		expect({
			line: document.querySelector("[data-tile-stack]")?.hasAttribute("data-tiles-line"),
			radius: root?.classList.contains("rounded-r7"),
			shadow: root?.classList.contains("shadow-panel-sm"),
			card: root?.classList.contains("rounded-card"),
			expand: {
				primary: classesOf("Expand").includes("text-primary"),
				secondary: classesOf("Expand").includes("text-secondary"),
			},
			close: {
				primary: classesOf("Close").includes("text-primary"),
				secondary: classesOf("Close").includes("text-secondary"),
			},
		}).toStrictEqual({
			line: true,
			radius: false,
			shadow: false,
			card: false,
			expand: {primary: true, secondary: false},
			close: {primary: true, secondary: false},
		});
	});

	it("scrolls pane bodies in upstream's scroller with 10px scroll padding for scrollIntoView", () => {
		renderHost("session-a");
		openTestPane();

		expect(screen.getByText("Test pane body").parentElement?.className.split(" ")).toStrictEqual([
			"h-full",
			"scroll-py-2.5",
			"overflow-y-auto",
			"[scrollbar-gutter:stable_both-edges]",
		]);
	});

	it("puts a pane's header actions after Move, before Expand and Close", () => {
		unregister();
		unregister = registerPane("plan", {
			title: "Test pane",
			headerActions: (
				<button type="button" aria-label="Pane action">
					A
				</button>
			),
			render: () => <p>Test pane body</p>,
		});
		renderHost("session-a");
		openTestPane();

		const root = screen.getByText("Test pane body").closest("[data-pane-root]");
		expect(
			[...(root?.querySelector("[data-pane-title]")?.parentElement?.querySelectorAll("button") ?? [])].map(
				(button) => button.getAttribute("aria-label"),
			),
		).toStrictEqual(["Move", "Pane action", "Expand", "Close"]);
	});

	it("renders an opened pane with its surface header", () => {
		renderHost("session-a");
		expect(screen.queryByText("Test pane body")).toBeNull();

		openTestPane();

		const root = screen.getByText("Test pane body").closest("[data-pane-root]");
		expect({
			title: root?.querySelector("[data-pane-title]")?.textContent,
			buttons: screen.getAllByRole("button").map((button) => ({
				name: button.getAttribute("aria-label") ?? button.textContent,
				keys: button.getAttribute("aria-keyshortcuts"),
			})),
			separator: separatorState(),
		}).toStrictEqual({
			title: "Test pane",
			buttons: [
				{name: "Move", keys: null},
				{name: "Open test pane", keys: null},
				{name: "Move", keys: null},
				{name: "Expand", keys: "Shift+Meta+\\"},
				{name: "Close", keys: "Meta+\\"},
			],
			separator: {
				label: "Resize Chat and Test pane",
				orientation: "vertical",
				now: "40",
				min: "27",
				max: "77",
			},
		});
	});

	it("lights the line-mode divider like upstream: seam hairline, 2px accent line on hover or drag, accent grip only on keyboard focus", () => {
		renderHost("session-a");
		openTestPane();
		const separator = screen.getByRole("separator");
		const classesOf = (element: Element | null | undefined) => element?.className.split(" ") ?? [];
		const line = classesOf(separator.querySelector("[data-tile-divider-line]"));
		const grip = classesOf(separator.querySelector("[data-tile-divider-grip]"));
		const dragging = () => separator.hasAttribute("data-dragging");

		expect({
			divider: {
				seam: classesOf(separator).includes("bg-seam"),
				border: classesOf(separator).includes("bg-border"),
				aboveTiles: classesOf(separator).includes("z-[4]"),
			},
			dragging: [
				dragging(),
				(fireEvent.pointerDown(separator, {pointerId: 1}), dragging()),
				(fireEvent.pointerUp(separator, {pointerId: 1}), dragging()),
			],
			line: line.filter((name) => /opacity|bg-|w-|delay|duration|left/.test(name)),
			grip: grip.filter((name) => /opacity|bg-/.test(name)),
		}).toStrictEqual({
			divider: {seam: true, border: false, aboveTiles: true},
			dragging: [false, true, false],
			line: [
				"left-[-0.5px]",
				"w-[2px]",
				"bg-fill-accent",
				"opacity-0",
				"transition-opacity",
				"duration-200",
				"delay-100",
				"group-hover/divider:opacity-100",
				"group-data-dragging/divider:opacity-100",
				"group-data-dragging/divider:duration-[120ms]",
				"group-data-dragging/divider:delay-0",
				"group-focus-visible/divider:opacity-0",
			],
			grip: ["bg-fill-accent", "opacity-0", "transition-opacity", "group-focus-visible/divider:opacity-100"],
		});
	});

	it("defines upstream's seam and border-line colours for light and dark", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		expect({
			seam: [...styles.matchAll(/--upstream-seam: (#[0-9a-f]+);/g)].map((match) => match[1]),
			line: [...styles.matchAll(/--upstream-border-line: (#[0-9a-f]+);/g)].map((match) => match[1]),
			seamColor: styles.includes("--color-seam: var(--upstream-seam);"),
			lineColor: styles.includes("--color-border-line: var(--upstream-border-line);"),
		}).toStrictEqual({
			seam: ["#0000001a", "#ffffff1a"],
			line: ["#0000001f", "#ffffff1f"],
			seamColor: true,
			lineColor: true,
		});
	});

	it("resizes with the keyboard and clamps to the minimum tile sizes", () => {
		renderHost("session-a");
		openTestPane();
		const separator = screen.getByRole("separator");

		fireEvent.keyDown(separator, {key: "ArrowLeft"});
		const afterOneLeft = separatorState().now;
		for (let i = 0; i < 40; i++) fireEvent.keyDown(separator, {key: "ArrowRight"});
		const afterManyRight = separatorState().now;
		for (let i = 0; i < 80; i++) fireEvent.keyDown(separator, {key: "ArrowLeft"});
		const afterManyLeft = separatorState().now;

		expect({afterOneLeft, afterManyRight, afterManyLeft}).toStrictEqual({
			afterOneLeft: "39",
			afterManyRight: "77",
			afterManyLeft: "27",
		});
	});

	it("closes the focused pane with ⌘\\", () => {
		renderHost("session-a");
		openTestPane();

		press({key: "\\", code: "Backslash", metaKey: true});

		expect({
			body: screen.queryByText("Test pane body"),
			separators: screen.queryAllByRole("separator").length,
		}).toStrictEqual({body: null, separators: 0});
	});

	it("toggles the expand overlay with ⇧⌘\\", () => {
		const onExpandWithoutPane = vi.fn<() => void>();
		renderHost("session-a", onExpandWithoutPane);

		press({key: "|", code: "Backslash", metaKey: true, shiftKey: true});
		const callsWithoutPane = onExpandWithoutPane.mock.calls.length;

		openTestPane();
		const chatTile = document.querySelector<HTMLElement>("[data-tile-host=chat]");
		press({key: "|", code: "Backslash", metaKey: true, shiftKey: true});
		const expanded = {
			chatHidden: chatTile?.hidden,
			overlay: document.querySelector("[data-pane-overlay]") !== null,
			toggle: screen.queryByRole("button", {name: "Collapse"}) !== null,
		};
		press({key: "|", code: "Backslash", metaKey: true, shiftKey: true});
		const collapsed = {
			chatHidden: chatTile?.hidden,
			overlay: document.querySelector("[data-pane-overlay]") !== null,
			toggle: screen.queryByRole("button", {name: "Collapse"}) !== null,
		};

		expect({
			callsWithoutPane,
			expanded,
			collapsed,
			calls: onExpandWithoutPane.mock.calls.length,
		}).toStrictEqual({
			callsWithoutPane: 1,
			expanded: {chatHidden: true, overlay: true, toggle: true},
			collapsed: {chatHidden: false, overlay: false, toggle: false},
			calls: 1,
		});
	});

	it("maximises the expanded pane over the whole window with a 9px inset", () => {
		renderHost("session-a");
		openTestPane();

		const expand = screen.getByRole("button", {name: "Expand"});
		const haspopup = expand.getAttribute("aria-haspopup");
		fireEvent.click(expand);
		const overlayClasses =
			screen
				.getByText("Test pane body")
				.closest("[data-pane-root]")
				?.closest("[data-pane-overlay]")
				?.className.split(" ") ?? [];

		expect({
			haspopup,
			fixed: overlayClasses.includes("fixed"),
			inset: overlayClasses.includes("inset-[9px]"),
		}).toStrictEqual({haspopup: "dialog", fixed: true, inset: true});
	});

	it.each([false, true])("preserves the pane reader and local state through expansion (nested: %s)", (nested) => {
		unregister();
		unregister = registerPane("plan", {
			title: "Test pane",
			render: () => (
				<div data-testid="pane-reader" style={{overflow: "auto", height: 100}}>
					<input aria-label="Draft comment" defaultValue="" />
					<details>
						<summary>Example file</summary>
						<div style={{height: 1000}}>Example lines</div>
					</details>
				</div>
			),
		});
		localStorage.setItem(
			"ccb.paneLayout.v1",
			JSON.stringify({
				"session-a": {
					root: {
						kind: "stack",
						direction: "row",
						flex: 1,
						children: nested
							? [
									{
										kind: "stack",
										direction: "column",
										flex: 1,
										children: [
											{kind: "tile", tileId: "chat", flex: 1},
											{kind: "tile", tileId: "plan", flex: 1},
										],
									},
								]
							: [
									{kind: "tile", tileId: "chat", flex: 1},
									{kind: "tile", tileId: "plan", flex: 1},
								],
					},
					expanded: null,
					focused: "plan",
				},
			}),
		);
		renderHost("session-a");
		const reader = screen.getByTestId("pane-reader");
		const draft = screen.getByRole<HTMLInputElement>("textbox", {name: "Draft comment"});
		const disclosure = reader.querySelector("details")!;
		const chat = document.querySelector<HTMLElement>("[data-tile-host=chat]")!;
		disclosure.open = true;
		fireEvent.change(draft, {target: {value: "Alice's draft"}});
		reader.scrollTop = 300;
		reader.scrollLeft = 100;

		for (const toggle of ["Expand", "Collapse", "Expand", "Collapse"]) {
			fireEvent.click(screen.getByRole("button", {name: toggle}));
			expect(screen.getByTestId("pane-reader")).toBe(reader);
			expect(document.querySelector("[data-tile-host=chat]")).toBe(chat);
			expect({
				top: reader.scrollTop,
				left: reader.scrollLeft,
				draft: draft.value,
				open: disclosure.open,
				chatHidden: chat.hidden,
				readers: screen.getAllByTestId("pane-reader").length,
			}).toStrictEqual({
				top: 300,
				left: 100,
				draft: "Alice's draft",
				open: true,
				chatHidden: toggle === "Expand",
				readers: 1,
			});
		}
	});

	it("returns focus to Expand after collapsing", () => {
		renderHost("session-a");
		openTestPane();

		fireEvent.click(screen.getByRole("button", {name: "Expand"}));
		fireEvent.click(screen.getByRole("button", {name: "Collapse"}));

		expect(document.activeElement).toBe(screen.getByRole("button", {name: "Expand"}));
	});

	function paneMoveButton(): HTMLElement {
		const pane = screen.getByText("Test pane body").closest<HTMLElement>("[data-pane-root]");
		if (pane === null) throw new Error("pane missing");
		return within(pane).getByRole("button", {name: "Move"});
	}

	function layoutShape() {
		return {
			columns: document.querySelectorAll("[data-tile-stack=column]").length,
			tiles: [...document.querySelectorAll("[data-tile-host]")].map((tile) =>
				tile.getAttribute("data-tile-host"),
			),
			preview: [...document.querySelectorAll("[data-tile-move-preview]")].map((preview) => ({
				tile: preview.closest("[data-tile-host]")?.getAttribute("data-tile-host") ?? null,
				side: preview.getAttribute("data-tile-move-preview"),
			})),
		};
	}

	it("shows upstream's Move tooltip on the move grip", () => {
		vi.useFakeTimers();
		try {
			renderHost("session-a");
			openTestPane();
			const anchor = paneMoveButton().parentElement;
			if (anchor === null) throw new Error("Move has no tooltip anchor");

			fireEvent.pointerEnter(anchor);
			act(() => {
				vi.advanceTimersByTime(400);
			});

			expect(screen.queryByRole("tooltip")?.textContent ?? null).toBe("Move");
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives the chat tile a Move grip once a side tile exists", () => {
		renderHost("session-a");
		const chatMoves = () =>
			within(document.querySelector<HTMLElement>("[data-tile-host=chat]") ?? document.body).queryAllByRole(
				"button",
				{name: "Move"},
			).length;
		const before = chatMoves();
		openTestPane();

		expect({before, after: chatMoves()}).toStrictEqual({before: 0, after: 1});
	});

	it("describes the move keys with upstream's full hint", () => {
		renderHost("session-a");
		openTestPane();
		const hintId = paneMoveButton().getAttribute("aria-describedby") ?? "";

		expect(document.getElementById(hintId)?.textContent).toBe(
			"Arrow keys move the tile. Perpendicular arrows preview a split; press Enter to commit or Escape to cancel.",
		);
	});

	it("moves along the row immediately", () => {
		renderHost("session-a");
		openTestPane();

		fireEvent.keyDown(paneMoveButton(), {key: "ArrowLeft"});

		expect(layoutShape()).toStrictEqual({columns: 0, tiles: ["plan", "chat"], preview: []});
	});

	it("previews a perpendicular split and commits it with Enter", () => {
		renderHost("session-a");
		openTestPane();

		fireEvent.keyDown(paneMoveButton(), {key: "ArrowDown"});
		const previewing = layoutShape();
		fireEvent.keyDown(paneMoveButton(), {key: "Enter"});

		expect({previewing, committed: layoutShape()}).toStrictEqual({
			previewing: {columns: 0, tiles: ["chat", "plan"], preview: [{tile: "chat", side: "bottom"}]},
			committed: {columns: 1, tiles: ["chat", "plan"], preview: []},
		});
	});

	it("cancels a split preview with Escape", () => {
		renderHost("session-a");
		openTestPane();

		fireEvent.keyDown(paneMoveButton(), {key: "ArrowDown"});
		fireEvent.keyDown(paneMoveButton(), {key: "Escape"});

		expect(layoutShape()).toStrictEqual({columns: 0, tiles: ["chat", "plan"], preview: []});
	});

	it("drags the Move grip over another tile to preview and commit a split", () => {
		renderHost("session-a");
		openTestPane();
		const chatTile = document.querySelector<HTMLElement>("[data-tile-host=chat]");
		stubElementFromPoint(chatTile);
		const grip = paneMoveButton();

		fireEvent.pointerDown(grip, {pointerId: 1, clientX: 900, clientY: 10});
		fireEvent.pointerMove(grip, {pointerId: 1, clientX: 600, clientY: 700});
		const previewing = layoutShape();
		fireEvent.pointerUp(grip, {pointerId: 1, clientX: 600, clientY: 700});

		expect({previewing, committed: layoutShape()}).toStrictEqual({
			previewing: {columns: 0, tiles: ["chat", "plan"], preview: [{tile: "chat", side: "bottom"}]},
			committed: {columns: 1, tiles: ["chat", "plan"], preview: []},
		});
	});

	it("marks the tiles root data-tiles-moving only while a Move drag is under way, hiding the divider hairline as upstream", () => {
		renderHost("session-a");
		openTestPane();
		stubElementFromPoint(document.querySelector<HTMLElement>("[data-tile-host=chat]"));
		const grip = paneMoveButton();
		const moving = () => document.querySelector("[data-tile-stack]")?.hasAttribute("data-tiles-moving");

		const states = [moving()];
		fireEvent.pointerDown(grip, {pointerId: 1, clientX: 900, clientY: 10});
		states.push(moving());
		fireEvent.pointerMove(grip, {pointerId: 1, clientX: 600, clientY: 700});
		states.push(moving());
		fireEvent.pointerUp(grip, {pointerId: 1, clientX: 600, clientY: 700});
		states.push(moving());
		fireEvent.pointerDown(paneMoveButton(), {pointerId: 2, clientX: 900, clientY: 10});
		fireEvent.pointerMove(paneMoveButton(), {pointerId: 2, clientX: 600, clientY: 300});
		states.push(moving());
		fireEvent.pointerCancel(paneMoveButton(), {pointerId: 2});
		states.push(moving());

		expect({
			states,
			hairlineHidden: screen
				.getByRole("separator")
				.className.split(" ")
				.includes("[[data-tiles-line][data-tiles-moving]_&]:bg-transparent"),
		}).toStrictEqual({states: [false, false, true, false, true, false], hairlineHidden: true});
	});

	it("ignores a Move grip press that does not leave the grip", () => {
		renderHost("session-a");
		openTestPane();
		const chatTile = document.querySelector<HTMLElement>("[data-tile-host=chat]");
		stubElementFromPoint(chatTile);
		const grip = paneMoveButton();

		fireEvent.pointerDown(grip, {pointerId: 1, clientX: 900, clientY: 10});
		fireEvent.pointerMove(grip, {pointerId: 1, clientX: 901, clientY: 11});
		fireEvent.pointerUp(grip, {pointerId: 1, clientX: 901, clientY: 11});

		expect(layoutShape()).toStrictEqual({columns: 0, tiles: ["chat", "plan"], preview: []});
	});

	it("persists the layout per session id across remounts", () => {
		const first = renderHost("session-a");
		openTestPane();
		first.unmount();

		const sameSession = renderHost("session-a");
		const restored = screen.queryByText("Test pane body") !== null;
		sameSession.unmount();

		renderHost("session-b");
		const otherSession = screen.queryByText("Test pane body") !== null;

		expect({restored, otherSession}).toStrictEqual({
			restored: true,
			otherSession: false,
		});
	});
});

describe("TileHost on a phone", () => {
	function mockViewport(width: number) {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === PHONE_SHEET_QUERY ? width < 640 : false,
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	}

	function paneSlotState() {
		const slot = screen.getByText("Test pane body").closest("[data-tile-host]");
		if (slot === null) throw new Error("pane slot missing");
		return {
			phone: slot.hasAttribute("data-pane-phone"),
			fullWidth: ["fixed", "inset-0", "w-full"].every((name) => slot.classList.contains(name)),
			paneMin: slot.classList.contains("min-w-[280px]"),
			sticky: slot.classList.contains("sticky"),
			separators: screen.queryAllByRole("separator").map((separator) => ({
				hairline: separator.classList.contains("w-px"),
				ruled: separator.classList.contains("bg-seam"),
				gap: separator.classList.contains("w-3"),
			})),
		};
	}

	function chatSlotState() {
		const slot = document.querySelector("[data-tile-host=chat]");
		if (slot === null) throw new Error("chat slot missing");
		return {
			fixed: slot.classList.contains("fixed"),
			chatMin: slot.classList.contains("min-w-[100px]"),
		};
	}

	it("keeps the pane beside the chat at its 280px minimum, squeezing the chat to 100px, below 640px", () => {
		mockViewport(390);
		renderHost("session-phone");
		openTestPane();

		expect({pane: paneSlotState(), chat: chatSlotState()}).toStrictEqual({
			pane: {
				phone: true,
				fullWidth: false,
				paneMin: true,
				sticky: false,
				separators: [{hairline: true, ruled: true, gap: false}],
			},
			chat: {fixed: false, chatMin: true},
		});
	});

	it("hides non-owning stack wrappers while a nested phone pane is expanded", () => {
		mockViewport(390);
		const unregisterFiles = registerPane("files", {title: "Files", render: () => <p>Files body</p>});
		const unregisterTasks = registerPane("background-tasks", {title: "Tasks", render: () => <p>Tasks body</p>});
		localStorage.setItem(
			"ccb.paneLayout.v1",
			JSON.stringify({
				"session-phone": {
					root: {
						kind: "stack",
						direction: "row",
						flex: 1,
						children: [
							{
								kind: "stack",
								direction: "column",
								flex: 1,
								children: [
									{kind: "tile", tileId: "chat", flex: 1},
									{kind: "tile", tileId: "plan", flex: 1},
								],
							},
							{
								kind: "stack",
								direction: "column",
								flex: 1,
								children: [
									{kind: "tile", tileId: "files", flex: 1},
									{kind: "tile", tileId: "background-tasks", flex: 1},
								],
							},
						],
					},
					expanded: null,
					focused: "plan",
				},
			}),
		);
		renderHost("session-phone");
		const pane = screen.getByRole("region", {name: "Test pane"});
		const wrappers = Array.from(document.querySelectorAll<HTMLElement>("[data-tile-stack=column]")).map(
			(stack) => stack.parentElement!,
		);
		fireEvent.click(within(pane).getByRole("button", {name: "Expand"}));
		expect(
			wrappers.map((wrapper) => ({fixed: wrapper.classList.contains("fixed"), hidden: wrapper.hidden})),
		).toStrictEqual([
			{fixed: false, hidden: false},
			{fixed: false, hidden: true},
		]);
		expect(screen.getByRole("region", {name: "Test pane"})).toBe(pane);
		expect(paneSlotState()).toStrictEqual({
			phone: true,
			fullWidth: true,
			paneMin: false,
			sticky: false,
			separators: [],
		});
		fireEvent.click(within(pane).getByRole("button", {name: "Collapse"}));
		expect(wrappers.map((wrapper) => wrapper.hidden)).toStrictEqual([false, false]);
		unregisterFiles();
		unregisterTasks();
	});

	it("drops the session card's inset at every width while a side pane shares the row, as upstream's line tiles run edge to edge", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");
		const lastShellRule = styles.lastIndexOf("[data-route-tile-shell] {");
		const lineRule = styles.indexOf(
			'[data-route-tile-shell="session"]:has([data-tiles-line]) { border-width: 0; padding: 0;',
		);

		expect({
			lineRule: lineRule !== -1,
			afterDesktopShell: lineRule > lastShellRule,
			phoneOnlyRule: styles.includes("[data-pane-phone])"),
		}).toStrictEqual({lineRule: true, afterDesktopShell: true, phoneOnlyRule: false});
	});

	it("flattens the pane surface below 640px, as upstream's phone pane has no radius or card shadow", () => {
		mockViewport(390);
		renderHost("session-phone");
		openTestPane();

		const classes = screen.getByRole("region", {name: "Test pane"}).className.split(" ");
		expect({radius: classes.includes("rounded-r7"), shadow: classes.includes("shadow-panel-sm")}).toStrictEqual({
			radius: false,
			shadow: false,
		});
	});

	it("stacks a second pane under the first in one 280px column below 640px, Changes included", () => {
		mockViewport(390);
		const unregisterChanges = registerPane("changes", {title: "Changes", render: () => <p>Changes body</p>});
		function TwoPaneChat() {
			const host = usePaneHost();
			return (
				<>
					<button
						type="button"
						onClick={() => {
							host.openPane("plan");
						}}
					>
						Open test pane
					</button>
					<button
						type="button"
						onClick={() => {
							host.openPane("changes");
						}}
					>
						Open changes
					</button>
				</>
			);
		}
		render(
			<TileHost sessionId="session-phone">
				<TwoPaneChat />
			</TileHost>,
		);
		openTestPane();
		fireEvent.click(screen.getByRole("button", {name: "Open changes"}));

		const root = document.querySelector("[data-tile-stack=row]");
		const column = document.querySelector("[data-tile-stack=column]");
		expect({
			rootChildren: Array.from(root?.children ?? []).map((child) =>
				child.matches("[role=separator]") ? "divider" : (child.getAttribute("data-tile-host") ?? "stack"),
			),
			column: Array.from(column?.children ?? []).map((child) =>
				child.matches("[role=separator]")
					? {
							divider: child.classList.contains("h-px") && !child.classList.contains("h-3"),
							ruled: child.classList.contains("bg-border-line"),
						}
					: child.getAttribute("data-tile-host"),
			),
			columnPhone: column?.parentElement?.hasAttribute("data-pane-phone"),
			columnMin: column?.parentElement?.classList.contains("min-w-[280px]"),
		}).toStrictEqual({
			rootChildren: ["chat", "divider", "stack"],
			column: ["plan", {divider: true, ruled: true}, "changes"],
			columnPhone: true,
			columnMin: true,
		});
		unregisterChanges();
	});

	it("reflows a saved three-column layout into one stacked side column below 640px without overwriting it", () => {
		const unregisterFiles = registerPane("files", {title: "Files", render: () => <p>Files body</p>});
		const unregisterChanges = registerPane("changes", {title: "Changes", render: () => <p>Changes body</p>});
		const saved = JSON.stringify({
			"session-phone": {
				root: {
					kind: "stack",
					direction: "row",
					flex: 1,
					children: [
						{kind: "tile", tileId: "chat", flex: 2},
						{
							kind: "stack",
							direction: "column",
							flex: 1,
							children: [
								{kind: "tile", tileId: "files", flex: 1},
								{kind: "tile", tileId: "plan", flex: 1},
							],
						},
						{kind: "tile", tileId: "changes", flex: 1},
					],
				},
				expanded: null,
				focused: "changes",
			},
		});
		localStorage.setItem("ccb.paneLayout.v1", saved);
		mockViewport(390);
		renderHost("session-phone");
		fireEvent.pointerDown(screen.getByText("Files body"));

		const root = document.querySelector("[data-tile-stack=row]");
		const column = document.querySelector("[data-tile-stack=column]");
		expect({
			rootChildren: Array.from(root?.children ?? []).map((child) =>
				child.matches("[role=separator]") ? "divider" : (child.getAttribute("data-tile-host") ?? "stack"),
			),
			column: Array.from(column?.children ?? []).map((child) =>
				child.matches("[role=separator]") ? "divider" : child.getAttribute("data-tile-host"),
			),
			stored: JSON.parse(localStorage.getItem("ccb.paneLayout.v1") ?? "null"),
		}).toStrictEqual({
			rootChildren: ["chat", "divider", "stack"],
			column: ["files", "divider", "plan", "divider", "changes"],
			stored: {"session-phone": {...JSON.parse(saved)["session-phone"], focused: "files"}},
		});
		unregisterFiles();
		unregisterChanges();
	});

	it("flattens the chat card at every width while a side pane shares the row, as upstream's line tiles are square-cornered", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");
		const tileFrame = readFileSync("src/components/session-tile-frame.tsx", "utf8");
		const fallback = readFileSync("src/components/app-shell-fallback.tsx", "utf8");

		expect({
			rule: styles.includes(
				'[data-route-tile-shell="session"]:has([data-tiles-line]) [data-session-tile] { border-radius: 0; box-shadow: none; }',
			),
			frameMarked: tileFrame.includes("data-session-tile"),
			fallbackMarked: fallback.includes("data-session-tile"),
		}).toStrictEqual({rule: true, frameMarked: true, fallbackMarked: true});
	});

	it("keeps the side-by-side tile with a hairline resize handle at 640px and up, as upstream's line mode does", () => {
		mockViewport(640);
		renderHost("session-wide");
		openTestPane();

		expect({pane: paneSlotState(), chat: chatSlotState()}).toStrictEqual({
			pane: {
				phone: false,
				fullWidth: false,
				paneMin: false,
				sticky: false,
				separators: [{hairline: true, ruled: true, gap: false}],
			},
			chat: {fixed: false, chatMin: false},
		});
	});
});

describe("TileHost corner handle", () => {
	let unregisterStacked: Array<() => void> = [];

	beforeEach(() => {
		unregisterStacked = [
			registerPane("files", {title: "Files", render: () => <p>Files body</p>}),
			registerPane("background-tasks", {title: "Background tasks", render: () => <p>Tasks body</p>}),
		];
		localStorage.setItem(
			"ccb.paneLayout.v1",
			JSON.stringify({
				"session-a": {
					root: {
						kind: "stack",
						direction: "row",
						flex: 1,
						children: [
							{kind: "tile", tileId: "chat", flex: 2},
							{
								kind: "stack",
								direction: "column",
								flex: 1,
								children: [
									{kind: "tile", tileId: "files", flex: 1},
									{kind: "tile", tileId: "background-tasks", flex: 1},
								],
							},
						],
					},
					expanded: null,
					focused: "files",
				},
			}),
		);
	});

	afterEach(() => {
		for (const fn of unregisterStacked) fn();
	});

	function flexes() {
		const flexOf = (selector: string) =>
			document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>("[style]")?.style.flex ?? null;
		return {
			chat: flexOf("[data-tile-host=chat]"),
			column: document.querySelector<HTMLElement>("[data-tile-stack=column]")?.style.flex ?? null,
			files: flexOf("[data-tile-host=files]"),
			tasks: flexOf("[data-tile-host=background-tasks]"),
		};
	}

	it("unmounts inactive pane contents while retaining the expanded sibling", () => {
		renderHost("session-a");
		const files = screen.getByRole("region", {name: "Files"});
		const tasks = screen.getByRole("region", {name: "Background tasks"});
		fireEvent.click(within(files).getByRole("button", {name: "Expand"}));
		expect(screen.getByRole("region", {name: "Files"})).toBe(files);
		expect(screen.queryByRole("region", {name: "Background tasks"})).toBe(null);
		expect({
			connected: tasks.isConnected,
			overlays: document.querySelectorAll("[data-pane-overlay]").length,
		}).toStrictEqual({connected: false, overlays: 1});
		fireEvent.click(within(files).getByRole("button", {name: "Collapse"}));
		expect(screen.getByRole("region", {name: "Background tasks"})).not.toBe(tasks);
		expect(screen.getByRole("region", {name: "Files"})).toBe(files);
	});

	it("resizes the row and the column together from the corner", () => {
		renderHost("session-a");
		const corner = document.querySelector<HTMLElement>("[data-tile-corner]");
		if (corner === null) throw new Error("corner missing");
		const before = flexes();

		fireEvent.pointerDown(corner, {pointerId: 1, clientX: 800, clientY: 400});
		fireEvent.pointerMove(corner, {pointerId: 1, clientX: 700, clientY: 300});
		fireEvent.pointerUp(corner, {pointerId: 1, clientX: 700, clientY: 300});

		expect({
			before,
			after: flexes(),
			cursor: corner.classList.contains("cursor-all-scroll"),
		}).toStrictEqual({
			before: {chat: "2 1 0px", column: "1 1 0px", files: "1 1 0px", tasks: "1 1 0px"},
			after: {
				chat: "1.747475 1 0px",
				column: "1.252525 1 0px",
				files: "0.746193 1 0px",
				tasks: "1.253807 1 0px",
			},
			cursor: true,
		});
	});
});
