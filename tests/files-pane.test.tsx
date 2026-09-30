// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FilesPaneShortcut, FilesPaneView, filesEmptyState} from "../src/components/panes/files-pane";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SettingsProvider} from "../src/components/settings-provider";
import {writeClipboardText} from "../src/lib/clipboard";
import type {SessionFiles} from "../src/lib/session-files";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn(),
}));

const SESSION_FILES = {
	files: [
		{
			path: "~/example/agent.ts",
			absolutePath: "/home/alice/example/agent.ts",
			occurrences: [
				{source: "visible", anchorIndex: 10, role: "assistant"},
				{source: "tool", anchorIndex: 20, role: "assistant", tool: "Read"},
			],
		},
		{
			path: "~/example/read-only.ts",
			absolutePath: "/home/alice/example/read-only.ts",
			occurrences: [{source: "tool", anchorIndex: 30, role: "assistant", tool: "Read"}],
		},
		{
			path: "~/notes/user.md",
			absolutePath: "/home/alice/notes/user.md",
			occurrences: [{source: "visible", anchorIndex: 40, role: "user"}],
		},
	],
	totalCount: 3,
	counts: {
		userMessage: 1,
		agentMessage: 1,
		read: 2,
		editWrite: 0,
		bash: 0,
		grepGlob: 0,
		thinking: 0,
		other: 0,
	},
} satisfies SessionFiles;

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function press(init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
	act(() => {
		document.body.dispatchEvent(event);
	});
	return event;
}

const CMD_SHIFT_F = {key: "f", code: "KeyF", metaKey: true, shiftKey: true};
const CTRL_SHIFT_F = {key: "F", code: "KeyF", ctrlKey: true, shiftKey: true};
const CTRL_SHIFT_Y = {key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true};

let unregister: () => void = () => {};

function registerFilesPane(sessionFiles: SessionFiles = SESSION_FILES, unscanned = 0): void {
	unregister = registerPane("files", {
		title: "Files",
		header: "custom",
		render: (chrome) => (
			<FilesPaneView chrome={chrome} sessionFiles={sessionFiles} unscannedRecordCount={unscanned} />
		),
	});
}

function renderSession(onExpandWithoutPane: () => void = () => {}) {
	return render(
		<SettingsProvider>
			<TileHost sessionId="files-pane" onExpandWithoutPane={onExpandWithoutPane}>
				<FilesPaneShortcut />
			</TileHost>
		</SettingsProvider>,
	);
}

function filesPane(): HTMLElement {
	return screen.getByRole("region", {name: "Files"});
}

function filesOpen(): string | null {
	return String(screen.queryByRole("region", {name: "Files"}) !== null);
}

beforeEach(() => {
	installLocalStorage();
	vi.mocked(writeClipboardText).mockReset();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
});

afterEach(() => {
	unregister();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("filesEmptyState", () => {
	it.each([
		[
			"no tabs, tree available",
			true,
			0,
			{
				title: "Open files appear here",
				detail: "Pick a file in the tree, or click a file path in the conversation.",
			},
		],
		[
			"no tabs, no tree",
			false,
			0,
			{
				title: "Open files appear here",
				detail: "Click a file path in the conversation to open it.",
			},
		],
		[
			"tabs open, none selected (tree shown)",
			true,
			2,
			{
				title: "No file selected",
				detail: "Pick an open file above, or click a file path in the conversation.",
			},
		],
		[
			"tabs open, none selected (tree hidden)",
			false,
			1,
			{
				title: "No file selected",
				detail: "Pick an open file above, or click a file path in the conversation.",
			},
		],
	])("%s", (_name, hasTree, tabCount, expected) => {
		expect(filesEmptyState(hasTree, tabCount)).toStrictEqual(expected);
	});
});

describe("Files pane shortcut", () => {
	it("⇧⌘F toggles the pane, focuses the filter, and never toggles chromeHidden", () => {
		registerFilesPane();
		const onExpandWithoutPane = vi.fn();
		renderSession(onExpandWithoutPane);

		const before = filesOpen();
		const opened = press(CMD_SHIFT_F);
		const afterOpen = filesOpen();
		const focusedLabel = document.activeElement?.getAttribute("aria-label");
		const closed = press(CMD_SHIFT_F);

		expect({
			before,
			afterOpen,
			focusedLabel,
			afterClose: filesOpen(),
			paneAfterClose: screen.queryByRole("region", {name: "Files"}),
			prevented: [opened.defaultPrevented, closed.defaultPrevented],
			chromeToggles: onExpandWithoutPane.mock.calls.length,
		}).toStrictEqual({
			before: "false",
			afterOpen: "true",
			focusedLabel: "Filter files",
			afterClose: "false",
			paneAfterClose: null,
			prevented: [true, true],
			chromeToggles: 0,
		});
	});

	it("⌃⇧F is not the Files shortcut on mac", () => {
		registerFilesPane();
		renderSession();

		const event = press(CTRL_SHIFT_F);

		expect({pressed: filesOpen(), prevented: event.defaultPrevented}).toStrictEqual({
			pressed: "false",
			prevented: false,
		});
	});
});

describe("Files pane header", () => {
	it("lists the header controls in upstream order", () => {
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const header = filesPane().querySelector("[data-files-header]");
		expect({
			labels: [...(header?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label")),
			title: header?.querySelector("[data-pane-title]")?.textContent,
		}).toStrictEqual({
			labels: ["Hide file tree", "Move", "Search files", "Files settings", "Expand", "Close"],
			title: "Files",
		});
	});

	it("the tree toggle hides the tree and switches the empty state copy", () => {
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const pane = filesPane();
		const toggle = within(pane).getByRole("button", {name: "Hide file tree"});
		const before = {
			pressed: toggle.getAttribute("aria-pressed"),
			keyshortcuts: toggle.getAttribute("aria-keyshortcuts"),
			tree: pane.querySelector("[data-files-tree]") !== null,
			detail:
				within(pane).queryByText("Pick a file in the tree, or click a file path in the conversation.") !== null,
		};
		fireEvent.click(toggle);
		const after = {
			pressed: within(pane).getByRole("button", {name: "Show file tree"}).getAttribute("aria-pressed"),
			tree: pane.querySelector("[data-files-tree]") !== null,
			detail: within(pane).queryByText("Click a file path in the conversation to open it.") !== null,
		};

		expect({before, after}).toStrictEqual({
			before: {pressed: "true", keyshortcuts: "Control+Shift+y", tree: true, detail: true},
			after: {pressed: "false", tree: false, detail: true},
		});
	});

	it("⌃⇧Y toggles the file tree while the Files pane is focused", () => {
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		const event = press(CTRL_SHIFT_Y);

		expect({
			prevented: event.defaultPrevented,
			toggle: within(filesPane())
				.getByRole("button", {name: /file tree$/})
				.getAttribute("aria-label"),
		}).toStrictEqual({prevented: true, toggle: "Show file tree"});
	});

	it("Files settings offers Hide ignored files, off by default and persisted", async () => {
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		fireEvent.click(within(filesPane()).getByRole("button", {name: "Files settings"}));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		const before = [...screen.getByRole("menu").querySelectorAll<HTMLElement>("[role^=menuitem]")].map((item) => [
			item.textContent ?? "",
			item.getAttribute("aria-checked"),
		]);
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Hide ignored files"}));

		expect({
			before,
			stored: localStorage.getItem("ccp-files-hide-ignored"),
			checked: screen.getByRole("menuitemcheckbox", {name: "Hide ignored files"}).getAttribute("aria-checked"),
		}).toStrictEqual({
			before: [
				["Show file tree⌃Control⇧ShiftY", "true"],
				["Preview tabs", "true"],
				["Hide ignored files", "false"],
				["Word wrap", "true"],
				["Tab size4", null],
				["Show files from", null],
			],
			stored: "true",
			checked: "true",
		});
	});

	it("Files settings toggles Word wrap and picks a Tab size, both persisted", async () => {
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);

		fireEvent.click(within(filesPane()).getByRole("button", {name: "Files settings"}));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Word wrap"}));
		fireEvent.click(screen.getByRole("menuitem", {name: /^Tab size/}));
		fireEvent.click(await screen.findByRole("menuitemradio", {name: "8"}));

		expect({
			wrap: localStorage.getItem("ccp-files-word-wrap"),
			tabSize: localStorage.getItem("ccp-files-tab-size"),
			radios: screen
				.getAllByRole("menuitemradio")
				.map((item) => [item.textContent, item.getAttribute("aria-checked")]),
		}).toStrictEqual({
			wrap: "false",
			tabSize: "8",
			radios: [
				["2", "false"],
				["4", "false"],
				["8", "true"],
			],
		});
	});

	it("Search files reveals a hidden tree and focuses the filter", async () => {
		registerFilesPane();
		renderSession();
		press(CMD_SHIFT_F);
		const pane = filesPane();
		fireEvent.click(within(pane).getByRole("button", {name: "Hide file tree"}));
		(document.activeElement as HTMLElement | null)?.blur();

		fireEvent.click(within(pane).getByRole("button", {name: "Search files"}));

		await waitFor(() =>
			expect({
				tree: pane.querySelector("[data-files-tree]") !== null,
				focused: document.activeElement?.getAttribute("aria-label"),
			}).toStrictEqual({tree: true, focused: "Filter files"}),
		);
	});
});
