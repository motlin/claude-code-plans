// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
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

beforeEach(() => {
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
	unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("TileHost", () => {
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
				{name: "Open test pane", keys: null},
				{name: "Move", keys: null},
				{name: "Expand", keys: "Shift+Meta+\\"},
				{name: "Close", keys: "Meta+\\"},
			],
			separator: {
				label: "Resize Chat and Test pane",
				orientation: "vertical",
				now: "67",
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
			afterOneLeft: "65",
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
