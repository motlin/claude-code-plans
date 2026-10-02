// @vitest-environment jsdom

import {act, cleanup, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChangesPaneView} from "../src/components/changes/changes-pane";
import {ChangesPaneShortcut} from "../src/components/changes/changes-pane-entry";
import {KeyboardShortcutsDialog, setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-dialog";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {SessionPaneControls} from "../src/components/view-options-menu";
import type {SessionDiffFile, SessionDiffResponse} from "../src/lib/api/session-diff";
import {installLocalStorage} from "./fake-storage";

const GREET_FILE: SessionDiffFile = {
	path: "src/greet.ts",
	status: "modified",
	additions: 1,
	deletions: 1,
	binary: false,
	patchLineCount: 6,
	patch: `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1 +1 @@
-export const greet = "hi";
+export const greet = "hello";
`,
};

const DIFF: SessionDiffResponse = {
	scope: "branch",
	source: "git",
	stats: {files: 1, additions: 1, deletions: 1},
	files: [GREET_FILE],
};

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function renderSession() {
	return render(
		<SettingsProvider>
			<TileHost sessionId="changes-shortcuts" onExpandWithoutPane={() => {}}>
				<ChangesPaneShortcut />
				<SessionPaneControls facts={{}} />
			</TileHost>
		</SettingsProvider>,
	);
}

function press(init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
	act(() => {
		document.body.dispatchEvent(event);
	});
	return event;
}

const CTRL_SHIFT_D = {key: "D", code: "KeyD", ctrlKey: true, shiftKey: true};
const CTRL_SHIFT_Y = {key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true};
const CMD_P = {key: "p", code: "KeyP", metaKey: true};

function changesPressed(): string | null {
	return screen.getByRole("button", {name: "Changes"}).getAttribute("aria-pressed");
}

function showFilesState(): string | null {
	return screen.getByRole("button", {name: /^(Show|Hide) files$/}).getAttribute("aria-pressed");
}

let unregister: () => void = () => {};

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
	unregister = registerPane("changes", {
		title: "Changes",
		render: () => <ChangesPaneView diff={DIFF} scopes={undefined} controls={<span />} onRefresh={() => {}} />,
	});
});

afterEach(() => {
	act(() => setKeyboardShortcutsOpen(false));
	unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Changes pane shortcuts", () => {
	it("⌃⇧D toggles the Changes pane", () => {
		renderSession();
		const before = changesPressed();
		const opened = press(CTRL_SHIFT_D);
		const afterOpen = changesPressed();
		const closed = press(CTRL_SHIFT_D);

		expect({
			before,
			afterOpen,
			afterClose: changesPressed(),
			prevented: [opened.defaultPrevented, closed.defaultPrevented],
		}).toStrictEqual({
			before: "false",
			afterOpen: "true",
			afterClose: "false",
			prevented: [true, true],
		});
	});

	it("⌃⇧Y toggles the file list only while the Changes pane is open", () => {
		renderSession();
		const whileClosed = press(CTRL_SHIFT_Y);
		press(CTRL_SHIFT_D);
		const before = showFilesState();
		const shown = press(CTRL_SHIFT_Y);
		const afterShow = showFilesState();
		press(CTRL_SHIFT_Y);

		expect({
			closedPrevented: whileClosed.defaultPrevented,
			before,
			shownPrevented: shown.defaultPrevented,
			afterShow,
			afterHide: showFilesState(),
		}).toStrictEqual({
			closedPrevented: false,
			before: "false",
			shownPrevented: true,
			afterShow: "true",
			afterHide: "false",
		});
	});

	it("⌘P opens Go to file only while the Changes pane is open", () => {
		renderSession();
		const whileClosed = press(CMD_P);
		const closedCombobox = screen.queryByRole("combobox", {name: "Search changed files"});
		press(CTRL_SHIFT_D);
		const whileOpen = press(CMD_P);

		expect({
			closedPrevented: whileClosed.defaultPrevented,
			closedCombobox,
			openPrevented: whileOpen.defaultPrevented,
			openCombobox: screen.getByRole("combobox", {name: "Search changed files"}).tagName,
		}).toStrictEqual({
			closedPrevented: false,
			closedCombobox: null,
			openPrevented: true,
			openCombobox: "INPUT",
		});
	});

	it("lists the three Changes shortcuts in the shortcuts dialog", async () => {
		render(<KeyboardShortcutsDialog />);
		act(() => setKeyboardShortcutsOpen(true));

		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"});
		const labels = within(dialog)
			.getAllByText(/changes/i)
			.map((element) => element.textContent);
		expect(labels).toStrictEqual([
			"Toggle changes",
			"Toggle file list in changes or files",
			"Go to file in changes or files",
		]);
	});
});
