// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FileRefsProvider} from "../src/components/file-refs";
import {SessionChat} from "../src/components/session-chat";
import {ToastProvider} from "../src/components/toast";
import {DensityScope} from "../src/components/ui/density";
import {type TranscriptActions, TranscriptActionsContext} from "../src/components/transcript-actions-context";
import {writeClipboardText} from "../src/lib/clipboard";
import type {FileRef} from "../src/lib/file-refs";
import {type ComposerHandle, getContextChips, registerComposer, takeContextChips} from "../src/lib/context-attach";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
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
	writeClipboardText: vi.fn<typeof import("../src/lib/clipboard").writeClipboardText>(async () =>
		Promise.resolve(true),
	),
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
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
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

function renderChat(wrapper?: (children: ReactNode) => ReactNode, records: unknown[] = RECORDS): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
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
	// The transcript sits in the compact main column.
	return render(<DensityScope density="compact">{wrapper ? wrapper(chat) : chat}</DensityScope>).container;
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
		// Submenu triggers carry their label as plain text.
		const title = row.querySelector("[data-menu-item-title]")?.textContent ?? row.textContent;
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

function recordingActions(calls: string[]): TranscriptActions {
	return {
		pinChapter: ({uuid}) => calls.push(`pin ${uuid}`),
		forkFrom: ({uuid}) => calls.push(`fork ${uuid}`),
		rewindTo: ({uuid}) => calls.push(`rewind ${uuid}`),
	};
}

function workingPaneActions(calls: string[]): TranscriptActions {
	return {...recordingActions(calls), rewindDisabledReason: "Rewind is unavailable while Claude is working"};
}

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
		await vi.waitFor(() => {
			expect(writeClipboardText).toHaveBeenCalled();
		});

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
		await vi.waitFor(() => {
			expect(writeClipboardText).toHaveBeenCalled();
		});

		expect({rows, clipboard: vi.mocked(writeClipboardText).mock.calls}).toStrictEqual({
			rows: ["Open in default browser", "Copy link", "---", ...ASSISTANT_ROWS],
			clipboard: [["https://example.com/docs"]],
		});
	});

	it("copies the message as plain text or as Markdown", async () => {
		const container = renderChat();
		clickItem(openMenuOn(find(container, "strong", "details")), "Copy message");
		clickItem(openMenuOn(find(container, "strong", "details")), "Copy message as Markdown");
		await vi.waitFor(() => {
			expect(writeClipboardText).toHaveBeenCalledTimes(2);
		});

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
		const unregister = registerComposer("test-session", {
			insertText: vi.fn<ComposerHandle["insertText"]>(),
			focus: vi.fn<ComposerHandle["focus"]>(),
		});
		const container = renderChat();
		clickItem(openMenuOn(find(container, ".user-message-bubble p")), "Attach message as context");
		const chips = getContextChips("test-session").map(({id: _id, ...chip}) => chip);
		unregister();

		expect(chips).toStrictEqual([{kind: "message", text: "Please run the tests"}]);
	});

	it("routes Pin, Fork and Rewind to the transcript actions with the message uuid", () => {
		const calls: string[] = [];
		const actions = recordingActions(calls);
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

	it("disables Rewind with upstream's reason while the pane works, leaving Fork enabled", () => {
		const calls: string[] = [];
		const actions = workingPaneActions(calls);
		const container = renderChat((chat) => (
			<TranscriptActionsContext.Provider value={actions}>{chat}</TranscriptActionsContext.Provider>
		));
		const menu = openMenuOn(find(container, ".user-message-bubble p"));
		const rows = [...menu.querySelectorAll('[role="menuitem"]')].map((row) => ({
			title: row.querySelector("[data-menu-item-title]")?.textContent,
			disabled: row.hasAttribute("data-disabled"),
			reason:
				row.getAttribute("aria-describedby") === null
					? null
					: menu.ownerDocument.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent,
		}));
		clickItem(menu, "Rewind to here");

		expect({rows: rows.slice(-2), calls}).toStrictEqual({
			rows: [
				{
					title: "Rewind to here",
					disabled: true,
					reason: "Rewind is unavailable while Claude is working",
				},
				{title: "Fork from here", disabled: false, reason: null},
			],
			calls: [],
		});
	});
});

describe("transcript context menu on a coarse pointer under 640px", () => {
	function stubCoarsePhone() {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
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

	it("presents the row menu as a ContextMenu bottom sheet with a handle and Close row, ignoring the pointer point", async () => {
		stubCoarsePhone();
		const container = renderChat();
		fireEvent.contextMenu(find(container, "strong", "details"), {clientX: 10, clientY: 10});
		// The sheet presentation is its own lazily loaded chunk.
		const menu = (await screen.findAllByRole("menu")).at(-1);
		const rows = menu?.querySelectorAll("[role=menuitem]");
		const positioner = menu?.parentElement;

		expect({
			cds: menu?.getAttribute("data-cds"),
			presentation: menu?.getAttribute("data-presentation"),
			size: menu?.getAttribute("data-size"),
			handle: menu?.firstElementChild?.hasAttribute("data-cds-sheet-handle"),
			lastRow: rows?.item(rows.length - 1).getAttribute("aria-label"),
			scrim: document.querySelector("[data-sheet-scrim]") !== null,
			positioner: {position: positioner?.style.position, inset: positioner?.style.inset},
		}).toStrictEqual({
			cds: "ContextMenu",
			presentation: "sheet",
			size: "lg",
			handle: true,
			lastRow: "Close",
			scrim: true,
			positioner: {position: "fixed", inset: "auto 0 0"},
		});
	});
});

describe("transcript file ref menus", () => {
	const FILE_RECORDS: unknown[] = [
		{type: "user", uuid: "user-1", message: {role: "user", content: "Where is the app?"}},
		{
			type: "assistant",
			uuid: "assistant-1",
			message: {role: "assistant", content: [{type: "text", text: "See `src/app.ts:12`, then run `npm test`."}]},
		},
		{
			type: "assistant",
			uuid: "assistant-2",
			message: {
				role: "assistant",
				content: [{type: "tool_use", id: "toolu_1", name: "Read", input: {file_path: "/repo/src/app.ts"}}],
			},
		},
		{
			type: "user",
			uuid: "user-2",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "export {};"}]},
		},
	];

	const FILE_ROWS = ["Attach as context", "Copy", "---", "Open in", "Show in Finder"];

	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input) !== "/api/file-refs")
					return Promise.resolve(Response.json({error: "not found"}, {status: 404}));
				const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
				return Promise.resolve(
					Response.json({
						statuses: Object.fromEntries(
							paths.map((path) => [path, path === "/repo/src/app.ts" ? "exists" : "missing"]),
						),
					}),
				);
			}),
		);
	});

	function withFileRefs(cwd: string | undefined) {
		const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
		return (children: ReactNode) => (
			<QueryClientProvider client={client}>
				<ToastProvider>
					<FileRefsProvider
						value={{
							sessionId: "test-session",
							cwd,
							sessionPaths: [],
							open: vi.fn<(ref: FileRef) => void>(),
						}}
					>
						{children}
					</FileRefsProvider>
				</ToastProvider>
			</QueryClientProvider>
		);
	}

	async function findFileRef(container: HTMLElement, selector: string): Promise<Element> {
		return vi.waitFor(() => find(container, selector));
	}

	/** Right-click a file ref and wait for its menu, which opens once the existence check answers. */
	async function openFileMenuOn(element: Element): Promise<HTMLElement> {
		fireEvent.contextMenu(element, {clientX: 10, clientY: 10});
		return vi.waitFor(() => {
			const menu = screen.getAllByRole("menu").at(-1);
			if (menu === undefined) throw new Error("no menu open");
			return menu;
		});
	}

	it("opens only the file actions menu on a prose file ref, at the default menu width", async () => {
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		const ref = await findFileRef(container, ".prose-link[data-file-ref]");
		const menu = await openFileMenuOn(ref);

		expect({
			rows: menuRows(menu),
			path: ref.getAttribute("data-file-path"),
			line: ref.getAttribute("data-file-line"),
			wide: menu.classList.contains("w-[225px]"),
		}).toStrictEqual({rows: FILE_ROWS, path: "/repo/src/app.ts", line: "12", wide: false});
	});

	it("attaches the prose file ref to the composer by its cwd-relative path", async () => {
		const unregister = registerComposer("test-session", {
			insertText: vi.fn<ComposerHandle["insertText"]>(),
			focus: vi.fn<ComposerHandle["focus"]>(),
		});
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		const menu = await openFileMenuOn(await findFileRef(container, ".prose-link[data-file-ref]"));
		clickItem(menu, "Attach as context");
		const chips = getContextChips("test-session").map(({id: _id, ...chip}) => chip);
		unregister();

		expect(chips).toStrictEqual([{kind: "file", path: "src/app.ts"}]);
	});

	it("opens the file actions menu, not the tool menu, on a tool row's file path", async () => {
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		fireEvent.click(find(container, "[data-tool-row] [aria-expanded]"));
		const ref = await findFileRef(container, "[data-tool-row] [data-file-ref]");
		const menu = await openFileMenuOn(ref);

		expect({rows: menuRows(menu), path: ref.getAttribute("data-file-path")}).toStrictEqual({
			rows: FILE_ROWS,
			path: "/repo/src/app.ts",
		});
	});

	/** Open a prose ref's Open in ▸, answering `/api/open-file` with `openStatus`, and pick Default app. */
	async function openInDefaultApp(openStatus: number): Promise<{openInRows: string[]; opened: unknown[]}> {
		const fileRefsFetch = vi.mocked(fetch).getMockImplementation();
		const opened: unknown[] = [];
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== "/api/open-file") return fileRefsFetch!(input, init);
			opened.push(JSON.parse(String(init?.body)));
			return Promise.resolve(
				Response.json(openStatus === 200 ? {ok: true} : {error: "no"}, {status: openStatus}),
			);
		});
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		const menu = await openFileMenuOn(await findFileRef(container, ".prose-link[data-file-ref]"));
		fireEvent.click(find(menu, '[role="menuitem"]', "Open in"));
		const submenu = await vi.waitFor(() => {
			const open = screen.getAllByRole("menu").at(-1);
			if (open === undefined || open === menu) throw new Error("Open in ▸ not open");
			return open;
		});
		const openInRows = menuRows(submenu);
		fireEvent.click(find(submenu, '[role="menuitem"]', "Default app"));
		await vi.waitFor(() => {
			expect(opened).toHaveLength(1);
		});
		return {openInRows, opened};
	}

	it("opens a prose file ref with its default app from Open in ▸ Default app", async () => {
		const result = await openInDefaultApp(200);

		expect({
			...result,
			toasts: [...document.querySelectorAll("[data-toast-message]")].map((toast) => toast.textContent),
		}).toStrictEqual({
			openInRows: ["VS Code", "---", "Default app"],
			opened: [{path: "/repo/src/app.ts"}],
			toasts: [],
		});
	});

	it("toasts upstream's error when the default app fails, and stays silent when the server blocks it", async () => {
		await openInDefaultApp(500);
		const failed = await screen.findByText("Couldn’t open this file with the default app.");
		const failedToasts = [...document.querySelectorAll("[data-toast-message]")].map((toast) => toast.textContent);
		cleanup();
		await openInDefaultApp(403);
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect({
			failed: failed.textContent,
			failedToasts,
			blockedToasts: [...document.querySelectorAll("[data-toast-message]")].map((toast) => toast.textContent),
		}).toStrictEqual({
			failed: "Couldn’t open this file with the default app.",
			failedToasts: ["Couldn’t open this file with the default app."],
			blockedToasts: [],
		});
	});

	/** Answer `/api/file-refs` for `/repo/src/app.ts` with `status`, after `delayMs` when given. */
	function answerAppStatus(status: "exists" | "missing", delayMs?: number): void {
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== "/api/file-refs")
				return Promise.resolve(Response.json({error: "not found"}, {status: 404}));
			const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
			if (delayMs !== undefined) {
				await new Promise((resolve) => {
					setTimeout(resolve, delayMs);
				});
			}
			return Response.json({
				statuses: Object.fromEntries(
					paths.map((path) => [path, path === "/repo/src/app.ts" ? status : "missing"]),
				),
			});
		});
	}

	it("hides Open in ▸ and Show in Finder for a file ref deleted since it rendered", async () => {
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		const ref = await findFileRef(container, ".prose-link[data-file-ref]");
		answerAppStatus("missing");
		const menu = await openFileMenuOn(ref);

		expect(menuRows(menu)).toStrictEqual(["Attach as context", "Copy"]);
	});

	it("opens after upstream's 150ms on a slow existence check, then hides the rows once the file proves gone", async () => {
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		const ref = await findFileRef(container, ".prose-link[data-file-ref]");
		answerAppStatus("missing", 400);
		fireEvent.contextMenu(ref, {clientX: 10, clientY: 10});
		const closedAt100 = await new Promise<boolean>((resolve) => {
			setTimeout(() => {
				resolve(screen.queryAllByRole("menu").length === 0);
			}, 100);
		});
		const menu = await vi.waitFor(() => screen.getByRole("menu"), {timeout: 300});
		const before = menuRows(menu);
		await vi.waitFor(
			() => {
				expect(menuRows(screen.getByRole("menu"))).toStrictEqual(["Attach as context", "Copy"]);
			},
			{timeout: 1000},
		);

		expect({closedAt100, before}).toStrictEqual({closedAt100: true, before: FILE_ROWS});
	});

	it("keeps Copy code on plain inline code beside a file ref", async () => {
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		await findFileRef(container, ".prose-link[data-file-ref]");
		const menu = openMenuOn(find(container, "code", "npm test"));

		expect(menuRows(menu)).toStrictEqual(["Copy code", "---", ...ASSISTANT_ROWS]);
	});

	it("falls back to the prose menu led by Copy path for a file ref without an absolute path", async () => {
		const container = renderChat(withFileRefs("/repo"), FILE_RECORDS);
		const ref = await findFileRef(container, ".prose-link[data-file-ref]");
		ref.removeAttribute("data-file-path");
		const menu = openMenuOn(ref);
		const rows = menuRows(menu);
		clickItem(menu, "Copy path");
		await vi.waitFor(() => {
			expect(writeClipboardText).toHaveBeenCalled();
		});

		expect({
			rows,
			clipboard: vi.mocked(writeClipboardText).mock.calls,
			toasts: [...document.querySelectorAll("[data-toast-message]")].map((toast) => toast.textContent),
		}).toStrictEqual({
			rows: ["Copy path", "---", ...ASSISTANT_ROWS],
			clipboard: [["src/app.ts:12"]],
			toasts: [],
		});
	});
});
