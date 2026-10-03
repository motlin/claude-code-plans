// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {type TranscriptActions, TranscriptActionsContext} from "../src/components/transcript-context-menu";
import {writeClipboardText} from "../src/lib/clipboard";
import {getContextChips, registerComposer, takeContextChips} from "../src/lib/context-attach";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));
vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn(async () => true),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	takeContextChips("test-session");
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const ASSISTANT_MARKDOWN = "Run `npm test` then read [the docs](https://example.com/docs) for **details**.";

const RECORDS: unknown[] = [
	{type: "user", uuid: "user-1", message: {role: "user", content: "Please run the tests"}},
	{
		type: "assistant",
		uuid: "assistant-1",
		message: {role: "assistant", content: [{type: "text", text: ASSISTANT_MARKDOWN}]},
	},
	{
		type: "assistant",
		uuid: "assistant-2",
		message: {
			role: "assistant",
			content: [{type: "tool_use", id: "toolu_1", name: "Bash", input: {command: "npm test"}}],
		},
	},
	{
		type: "user",
		uuid: "user-2",
		message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "ok"}]},
	},
];

function renderChat(wrapper?: (children: ReactNode) => ReactNode): HTMLElement {
	const {lines, toolResultMap} = processTranscript(RECORDS);
	const chat = (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>
	);
	return render(<>{wrapper ? wrapper(chat) : chat}</>).container;
}

function openMenuOn(element: Element): HTMLElement {
	fireEvent.contextMenu(element, {clientX: 10, clientY: 10});
	const menu = screen.getAllByRole("menu").at(-1);
	if (menu === undefined) throw new Error("no menu open");
	return menu;
}

/** The menu's rows top to bottom; "---" for separators, "title / description" for two-line items. */
function menuRows(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) => {
		if (row.getAttribute("role") === "separator") return "---";
		const title = row.querySelector("[data-menu-item-title]")?.textContent ?? "";
		const description = row.querySelector("[data-menu-item-description]")?.textContent;
		return description === undefined ? title : `${title} / ${description}`;
	});
}

function clickItem(menu: HTMLElement, title: string): void {
	const item = [...menu.querySelectorAll('[role="menuitem"]')].find(
		(row) => row.querySelector("[data-menu-item-title]")?.textContent === title,
	);
	if (item === undefined) throw new Error(`no item ${title}`);
	fireEvent.click(item);
}

function find(container: HTMLElement, selector: string, text?: string): Element {
	const found = [...container.querySelectorAll(selector)].find(
		(element) => text === undefined || element.textContent === text,
	);
	if (found === undefined) throw new Error(`no ${selector} ${text ?? ""}`);
	return found;
}

const ASSISTANT_ROWS = [
	"Copy message",
	"Copy message as Markdown",
	"Read aloud",
	"---",
	"Attach message as context",
	"Pin as chapter",
	"---",
	"Fork from here / Starts a new session, keeps this one",
];

describe("transcript context menus", () => {
	it("opens the assistant prose menu at upstream's width", () => {
		const container = renderChat();
		const menu = openMenuOn(find(container, "strong", "details"));

		expect({rows: menuRows(menu), wide: menu.classList.contains("w-[225px]")}).toStrictEqual({
			rows: ASSISTANT_ROWS,
			wide: true,
		});
	});

	it("adds Copy code on inline code and copies the code text", async () => {
		const container = renderChat();
		const menu = openMenuOn(find(container, "code", "npm test"));
		const rows = menuRows(menu);
		clickItem(menu, "Copy code");
		await vi.waitFor(() => expect(writeClipboardText).toHaveBeenCalled());

		expect({rows, clipboard: vi.mocked(writeClipboardText).mock.calls}).toStrictEqual({
			rows: ["Copy code", "---", ...ASSISTANT_ROWS],
			clipboard: [["npm test"]],
		});
	});

	it("adds Open in default browser and Copy link on a link", async () => {
		const container = renderChat();
		const menu = openMenuOn(find(container, "a[href]", "the docs"));
		const rows = menuRows(menu);
		clickItem(menu, "Copy link");
		await vi.waitFor(() => expect(writeClipboardText).toHaveBeenCalled());

		expect({rows, clipboard: vi.mocked(writeClipboardText).mock.calls}).toStrictEqual({
			rows: ["Open in default browser", "Copy link", "---", ...ASSISTANT_ROWS],
			clipboard: [["https://example.com/docs"]],
		});
	});

	it("copies the message as plain text or as Markdown", async () => {
		const container = renderChat();
		clickItem(openMenuOn(find(container, "strong", "details")), "Copy message");
		clickItem(openMenuOn(find(container, "strong", "details")), "Copy message as Markdown");
		await vi.waitFor(() => expect(writeClipboardText).toHaveBeenCalledTimes(2));

		expect(vi.mocked(writeClipboardText).mock.calls).toStrictEqual([
			["Run npm test then read the docs for details."],
			[ASSISTANT_MARKDOWN],
		]);
	});

	it("opens the tool row menu on a tool row", () => {
		const container = renderChat();
		const menu = openMenuOn(find(container, "[data-tool-row]"));

		expect(menuRows(menu)).toStrictEqual([
			"Pin as chapter",
			"---",
			"Fork from here / Starts a new session, keeps this one",
		]);
	});

	it("opens the user message menu at upstream's width", () => {
		const container = renderChat();
		const menu = openMenuOn(find(container, ".user-message-bubble p"));

		const twoLine = [...menu.querySelectorAll('[role="menuitem"]')]
			.filter((row) => row.classList.contains("min-h-[41px]") && !row.classList.contains("h-6"))
			.map((row) => row.querySelector("[data-menu-item-title]")?.textContent);

		expect({rows: menuRows(menu), wide: menu.classList.contains("w-[249px]"), twoLine}).toStrictEqual({
			rows: [
				"Copy message",
				"Copy message as Markdown",
				"---",
				"Attach message as context",
				"---",
				"Rewind to here / Removes this message and what follows",
				"Fork from here / Starts a new session, keeps this one",
			],
			wide: true,
			twoLine: ["Rewind to here", "Fork from here"],
		});
	});

	it("attaches the message to the composer as a context chip", () => {
		const unregister = registerComposer("test-session", {insertText: vi.fn(), focus: vi.fn()});
		const container = renderChat();
		clickItem(openMenuOn(find(container, ".user-message-bubble p")), "Attach message as context");
		const chips = getContextChips("test-session").map(({id: _id, ...chip}) => chip);
		unregister();

		expect(chips).toStrictEqual([{kind: "message", text: "Please run the tests"}]);
	});

	it("routes Pin, Fork and Rewind to the transcript actions with the message uuid", () => {
		const calls: string[] = [];
		const actions: TranscriptActions = {
			pinChapter: ({uuid}) => calls.push(`pin ${uuid}`),
			forkFrom: ({uuid}) => calls.push(`fork ${uuid}`),
			rewindTo: ({uuid}) => calls.push(`rewind ${uuid}`),
		};
		const container = renderChat((chat) => (
			<TranscriptActionsContext.Provider value={actions}>{chat}</TranscriptActionsContext.Provider>
		));
		clickItem(openMenuOn(find(container, "strong", "details")), "Pin as chapter");
		clickItem(openMenuOn(find(container, "[data-tool-row]")), "Fork from here");
		clickItem(openMenuOn(find(container, ".user-message-bubble p")), "Rewind to here");

		expect(calls).toStrictEqual(["pin assistant-1", "fork assistant-2", "rewind user-1"]);
	});

	it("disables Pin, Fork and Rewind when no transcript actions are provided", () => {
		const container = renderChat();
		const menu = openMenuOn(find(container, ".user-message-bubble p"));
		const disabled = [...menu.querySelectorAll('[role="menuitem"][data-disabled]')].map(
			(row) => row.querySelector("[data-menu-item-title]")?.textContent,
		);

		expect(disabled).toStrictEqual(["Rewind to here", "Fork from here"]);
	});
});
