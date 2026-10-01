// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost, usePaneHost} from "../src/components/panes/tile-host";
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
		<button type="button" onClick={() => host.openPane("plan")}>
			Open test pane
		</button>
	);
}

function renderHost(sessionId: string, onExpandWithoutPane = vi.fn()) {
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

	it("draws the pane surface with upstream's 10px radius and primary-ink header buttons", () => {
		renderHost("session-a");
		openTestPane();

		const root = screen.getByText("Test pane body").closest("section[data-pane-root]");
		const classesOf = (name: string) => screen.getByRole("button", {name}).className.split(" ");
		expect({
			radius: root?.classList.contains("rounded-r7"),
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
			radius: true,
			card: false,
			expand: {primary: true, secondary: false},
			close: {primary: true, secondary: false},
		});
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
				max: "76",
			},
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
			afterManyRight: "76",
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
		const onExpandWithoutPane = vi.fn();
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
			act(() => vi.advanceTimersByTime(400));

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
			sticky: slot.classList.contains("sticky"),
			separators: screen.queryAllByRole("separator").length,
		};
	}

	it("covers the viewport with the pane and hides the resize handle below 640px", () => {
		mockViewport(390);
		renderHost("session-phone");
		openTestPane();

		expect(paneSlotState()).toStrictEqual({
			phone: true,
			fullWidth: true,
			sticky: false,
			separators: 0,
		});
	});

	it("keeps the side-by-side tile with its resize handle at 640px and up", () => {
		mockViewport(640);
		renderHost("session-wide");
		openTestPane();

		expect(paneSlotState()).toStrictEqual({
			phone: false,
			fullWidth: false,
			sticky: true,
			separators: 1,
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
