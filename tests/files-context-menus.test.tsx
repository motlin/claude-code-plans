// @vitest-environment jsdom

import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {FileTabsStrip} from "../src/components/files/file-tabs-strip";
import {FileView} from "../src/components/files/file-view";
import {FilesTree, FilesTreeColumn} from "../src/components/files/files-tree";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {decodeFilePath} from "../src/lib/api/file";
import {writeClipboardText} from "../src/lib/clipboard";
import {
	appendAttachment,
	type AttachContextHandler,
	attachContext,
	formatAttachContext,
	getContextChips,
	requestComposerInsert,
	takeContextChips,
} from "../src/lib/context-attach";
import type {FileTabsState} from "../src/lib/file-tabs";
import {handleRevealInFinder} from "../src/lib/open-in-finder";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/lib/clipboard", () => ({
	writeClipboardText: vi.fn(async () => true),
}));

vi.mock("../src/hooks/use-shiki", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/hooks/use-shiki")>()),
	useHighlightedLines: () => null,
}));

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const CWD = "/home/alice/project";
const AGENT = `${CWD}/src/agent.ts`;
const AGENT_SOURCE = "const alice = 1;\nconst bob = 2;\nconst carol = 3;\n";

let fetchCalls: Array<{url: string; init: RequestInit | undefined}>;

function stubFetch(): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			fetchCalls.push({url: input, init});
			const url = new URL(input, "http://localhost");
			if (url.pathname.startsWith("/api/file/")) {
				const path = decodeFilePath(url.pathname.slice("/api/file/".length)) ?? "";
				if (path === AGENT) return Response.json({content: AGENT_SOURCE, path});
				return Response.json({error: "File not found"}, {status: 404});
			}
			if (url.pathname === "/api/reveal-in-finder") return Response.json({ok: true});
			if (url.pathname.endsWith("/files")) {
				return Response.json({
					kind: "listing",
					dir: "",
					entries: [
						{name: "src", relPath: "src", isDirectory: true},
						{name: "README.md", relPath: "README.md", isDirectory: false},
					],
					partial: false,
				});
			}
			return Response.json({error: "not found"}, {status: 404});
		}),
	);
}

function wrap(children: ReactNode) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return (
		<QueryClientProvider client={queryClient}>
			<SettingsProvider>
				<ToastProvider>{children}</ToastProvider>
			</SettingsProvider>
		</QueryClientProvider>
	);
}

/** The open menu's rows, top to bottom: item labels, with "─" for separators. */
function menuRows(): string[] {
	const menus = screen.getAllByRole("menu");
	const menu = menus.at(-1);
	if (menu === undefined) throw new Error("no menu open");
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
		row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent ?? ""),
	);
}

function openSubmenu(label: string): string[] {
	const trigger = screen.getAllByRole("menuitem").find((item) => item.firstElementChild?.textContent === label);
	if (trigger === undefined) throw new Error(`no submenu ${label}`);
	fireEvent.click(trigger);
	return menuRows();
}

function clickItem(label: string): void {
	const item = screen
		.getAllByRole("menuitem")
		.find((candidate) => candidate.firstElementChild?.textContent === label);
	if (item === undefined) throw new Error(`no item ${label}`);
	fireEvent.click(item);
}

function press(init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
	act(() => {
		document.body.dispatchEvent(event);
	});
	return event;
}

const CMD_SHIFT_L = {key: "l", code: "KeyL", metaKey: true, shiftKey: true};

function selectLines(first: number, last: number): void {
	const start = document.querySelector(`#L${first} code`)?.firstChild;
	const end = document.querySelector(`#L${last} code`)?.firstChild;
	if (!start || !end) throw new Error("lines not rendered");
	const range = document.createRange();
	range.setStart(start, 2);
	range.setEnd(end, 3);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

beforeEach(() => {
	installLocalStorage();
	fetchCalls = [];
	stubFetch();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: () => {},
	});
	vi.mocked(writeClipboardText).mockClear();
});

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("formatAttachContext", () => {
	it.each([
		["a whole file", {path: "src/agent.ts"}, "@src/agent.ts"],
		["a line range", {path: "src/agent.ts", range: {start: 3, end: 7}}, "@src/agent.ts#L3-7"],
		["a single line", {path: "src/agent.ts", range: {start: 4, end: 4}}, "@src/agent.ts#L4"],
		[
			"a selection with lines",
			{
				path: "src/agent.ts",
				range: {start: 1, end: 2},
				text: "const alice = 1;\nconst bob = 2;",
				language: "typescript",
			},
			"@src/agent.ts#L1-2\n```typescript\nconst alice = 1;\nconst bob = 2;\n```",
		],
		[
			"a selection without lines",
			{path: "notes/alice.md", text: "Alice's notes", language: null},
			"@notes/alice.md\n```\nAlice's notes\n```",
		],
		[
			"a selection holding a fence",
			{path: "notes/bob.md", text: "```sh\nls\n```", language: "markdown"},
			"@notes/bob.md\n````markdown\n```sh\nls\n```\n````",
		],
	])("%s", (_name, input, expected) => {
		expect(formatAttachContext(input)).toBe(expected);
	});
});

describe("appendAttachment", () => {
	it.each([
		["an empty prompt", "", "@src/agent.ts", "@src/agent.ts "],
		["a prompt without trailing space", "Look at", "@src/agent.ts", "Look at @src/agent.ts "],
		["a prompt with trailing space", "Look at ", "@src/agent.ts", "Look at @src/agent.ts "],
		["a fenced selection", "Explain", "@a.ts#L1\n```\nx\n```", "Explain\n@a.ts#L1\n```\nx\n```\n"],
		["a fenced selection into an empty prompt", "", "@a.ts#L1\n```\nx\n```", "@a.ts#L1\n```\nx\n```\n"],
	])("%s", (_name, prompt, snippet, expected) => {
		expect(appendAttachment(prompt, snippet)).toBe(expected);
	});
});

describe("tree row context menu", () => {
	it("offers Attach as context and Copy ▸ {Absolute path, Relative path, Filename}", async () => {
		const onAttachContext = vi.fn();
		render(
			wrap(
				<FilesTreeColumn>
					<FilesTree sessionId="alice" cwd={CWD} onAttachContext={onAttachContext} />
				</FilesTreeColumn>,
			),
		);
		const row = await screen.findByText("README.md");

		fireEvent.contextMenu(row, {clientX: 10, clientY: 10});
		const rows = await waitFor(() => menuRows());
		const copyRows = openSubmenu("Copy");
		clickItem("Absolute path");
		await waitFor(() => expect(writeClipboardText).toHaveBeenCalled());

		fireEvent.contextMenu(screen.getByText("README.md"), {clientX: 10, clientY: 10});
		await waitFor(() => menuRows());
		clickItem("Attach as context");

		expect({
			rows,
			copyRows,
			copied: vi.mocked(writeClipboardText).mock.calls,
			attached: onAttachContext.mock.calls,
		}).toStrictEqual({
			rows: ["Attach as context", "Copy"],
			copyRows: ["Absolute path", "Relative path", "Filename"],
			copied: [[`${CWD}/README.md`]],
			attached: [[{kind: "file", path: "README.md"}]],
		});
	});
});

describe("tab context menu", () => {
	const state: FileTabsState = {
		tabs: [
			{path: AGENT, preview: false},
			{path: `${CWD}/README.md`, preview: true},
		],
		active: AGENT,
	};

	it("adds Reveal in file tree and the Close actions", async () => {
		const dispatch = vi.fn();
		const onRevealInTree = vi.fn();
		render(
			wrap(
				<FileTabsStrip
					state={state}
					dispatch={dispatch}
					cwd={CWD}
					onAttachContext={() => {}}
					onRevealInTree={onRevealInTree}
				/>,
			),
		);

		fireEvent.contextMenu(screen.getByRole("tab", {name: /agent\.ts/}), {
			clientX: 10,
			clientY: 10,
		});
		const rows = await waitFor(() => menuRows());
		clickItem("Close other files");
		fireEvent.contextMenu(screen.getByRole("tab", {name: /agent\.ts/}), {
			clientX: 10,
			clientY: 10,
		});
		await waitFor(() => menuRows());
		clickItem("Reveal in file tree");

		expect({
			rows,
			dispatched: dispatch.mock.calls,
			revealed: onRevealInTree.mock.calls,
		}).toStrictEqual({
			rows: [
				"Attach as context",
				"Copy",
				"─",
				"Reveal in file tree",
				"─",
				"Close file",
				"Close other files",
				"Close all files",
			],
			dispatched: [[{type: "closeOthers", path: AGENT}]],
			revealed: [[AGENT]],
		});
	});
});

describe("viewer context menu", () => {
	it("adds Copy file contents, Download file and Open in ▸ {VS Code, Finder}", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		render(wrap(<FileView path={AGENT} cwd={CWD} onAttachContext={() => {}} />));
		const viewer = await waitFor(() => {
			const element = document.querySelector<HTMLElement>("[data-file-viewer]");
			if (!element?.querySelector("#L1")) throw new Error("not loaded");
			return element;
		});

		fireEvent.contextMenu(viewer, {clientX: 10, clientY: 10});
		const rows = await waitFor(() => menuRows());
		const openInRows = openSubmenu("Open in");
		clickItem("VS Code");

		fireEvent.contextMenu(viewer, {clientX: 10, clientY: 10});
		await waitFor(() => menuRows());
		openSubmenu("Open in");
		clickItem("Finder");
		await waitFor(() => expect(fetchCalls.some((call) => call.url === "/api/reveal-in-finder")).toBe(true));

		fireEvent.contextMenu(viewer, {clientX: 10, clientY: 10});
		await waitFor(() => menuRows());
		clickItem("Copy file contents");
		await waitFor(() => expect(writeClipboardText).toHaveBeenCalled());

		const reveal = fetchCalls.find((call) => call.url === "/api/reveal-in-finder");
		expect({
			rows,
			openInRows,
			opened: open.mock.calls,
			revealBody: reveal?.init?.body,
			copied: vi.mocked(writeClipboardText).mock.calls,
		}).toStrictEqual({
			rows: ["Attach as context", "Copy", "Copy file contents", "Download file", "─", "Open in"],
			openInRows: ["VS Code", "Finder"],
			opened: [["vscode://file/home/alice/project/src/agent.ts:1", "_self"]],
			revealBody: JSON.stringify({path: AGENT}),
			copied: [[AGENT_SOURCE]],
		});
	});

	it("attaches the selected lines from the menu", async () => {
		const onAttachContext = vi.fn();
		render(wrap(<FileView path={AGENT} cwd={CWD} onAttachContext={onAttachContext} />));
		await waitFor(() => {
			if (!document.querySelector("#L3")) throw new Error("not loaded");
		});
		selectLines(1, 2);

		fireEvent.contextMenu(document.querySelector("#L2 code") as Element, {
			clientX: 10,
			clientY: 10,
		});
		await waitFor(() => menuRows());
		clickItem("Attach as context");

		expect(onAttachContext.mock.calls).toStrictEqual([
			[
				{
					kind: "selection",
					path: "src/agent.ts",
					range: {start: 1, end: 2},
					text: "const alice = 1;\nconst bob = 2;",
					language: "typescript",
				},
			],
		]);
	});
});

describe("⇧⌘L attach selection", () => {
	async function renderLoaded(onAttachContext: AttachContextHandler) {
		render(
			wrap(
				<>
					<p>Alice's transcript text</p>
					<FileView path={AGENT} cwd={CWD} onAttachContext={onAttachContext} />
				</>,
			),
		);
		await waitFor(() => {
			if (!document.querySelector("#L3")) throw new Error("not loaded");
		});
	}

	it("attaches the selection when it is inside the viewer", async () => {
		const onAttachContext = vi.fn();
		await renderLoaded(onAttachContext);
		selectLines(2, 3);

		const event = press(CMD_SHIFT_L);

		expect({
			prevented: event.defaultPrevented,
			attached: onAttachContext.mock.calls,
		}).toStrictEqual({
			prevented: true,
			attached: [
				[
					{
						kind: "selection",
						path: "src/agent.ts",
						range: {start: 2, end: 3},
						text: "const bob = 2;\nconst carol = 3;",
						language: "typescript",
					},
				],
			],
		});
	});

	it("does nothing without a selection or with one outside the viewer", async () => {
		const onAttachContext = vi.fn();
		await renderLoaded(onAttachContext);

		const empty = press(CMD_SHIFT_L);
		const outside = screen.getByText("Alice's transcript text").firstChild as Text;
		const range = document.createRange();
		range.setStart(outside, 0);
		range.setEnd(outside, 5);
		window.getSelection()?.addRange(range);
		const elsewhere = press(CMD_SHIFT_L);

		expect({
			emptyPrevented: empty.defaultPrevented,
			elsewherePrevented: elsewhere.defaultPrevented,
			attached: onAttachContext.mock.calls,
		}).toStrictEqual({emptyPrevented: false, elsewherePrevented: false, attached: []});
	});
});

describe("composer attach requests", () => {
	afterEach(() => {
		takeContextChips("alice-session");
	});

	it("appends requested text, such as a fix prompt, to the session's prompt", () => {
		render(<Composer variant="session" draftKey="alice-session" onSend={() => {}} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		fireEvent.change(textarea, {target: {value: "Look at"}});

		let delivered = false;
		act(() => {
			delivered = requestComposerInsert("alice-session", "@src/agent.ts");
		});
		const otherSession = requestComposerInsert("bob-session", "@src/bob.ts");

		expect({delivered, otherSession, value: textarea.value}).toStrictEqual({
			delivered: true,
			otherSession: false,
			value: "Look at @src/agent.ts ",
		});
	});

	it("shows attached context as removable chips and sends it ahead of the prompt", () => {
		const onSend = vi.fn();
		render(<Composer variant="session" draftKey="alice-session" onSend={onSend} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});

		act(() => {
			attachContext("alice-session", {kind: "file", path: "src/alice.ts"});
			attachContext("alice-session", {
				kind: "selection",
				path: "src/agent.ts",
				range: {start: 2, end: 3},
				text: "const bob = 2;\nconst carol = 3;",
				language: "typescript",
			});
			attachContext("alice-session", {kind: "terminal", text: "$ ls"});
		});
		const strip = screen.getByRole("list", {name: "Attached context"});
		const chips = Array.from(strip.querySelectorAll("li")).map((chip) => chip.textContent);
		const sendEnabled = !screen.getByRole<HTMLButtonElement>("button", {name: "Send"}).disabled;

		fireEvent.click(screen.getByRole("button", {name: "Remove Terminal output"}));
		fireEvent.change(textarea, {target: {value: "Explain"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			chips,
			sendEnabled,
			prompt: textarea.value,
			sent: onSend.mock.calls,
			stripAfter: screen.queryByRole("list", {name: "Attached context"}),
			left: getContextChips("alice-session"),
		}).toStrictEqual({
			chips: ["alice.ts", "agent.ts:2-3", "Terminal output"],
			sendEnabled: true,
			prompt: "",
			sent: [
				[
					"@src/alice.ts\n\n@src/agent.ts#L2-3\n```typescript\nconst bob = 2;\nconst carol = 3;\n```\n\nExplain",
					{},
				],
			],
			stripAfter: null,
			left: [],
		});
	});
});

describe("handleRevealInFinder", () => {
	let root: string;

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "reveal-in-finder-")));
		await mkdir(join(root, "allowed"));
		await writeFile(join(root, "allowed", "alice.ts"), "alice");
		await writeFile(join(root, "outside.ts"), "bob");
	});

	afterEach(async () => {
		await rm(root, {recursive: true, force: true});
	});

	function reveal(body: unknown, revealPath: (path: string) => Promise<void>) {
		return handleRevealInFinder(
			new Request("http://localhost/api/reveal-in-finder", {
				method: "POST",
				body: JSON.stringify(body),
			}),
			{
				rejectRequest: () => null,
				resolveRoots: async () => [join(root, "allowed")],
				configPath: join(root, "missing-config.json"),
				revealPath,
			},
		);
	}

	it("reveals an allowed file and refuses paths outside the allowed roots", async () => {
		const revealPath = vi.fn(async () => {});
		const allowed = await reveal({path: join(root, "allowed", "alice.ts")}, revealPath);
		const outside = await reveal({path: join(root, "outside.ts")}, revealPath);
		const malformed = await reveal({path: 42}, revealPath);

		expect({
			statuses: [allowed.status, outside.status, malformed.status],
			revealed: revealPath.mock.calls,
		}).toStrictEqual({
			statuses: [200, 403, 400],
			revealed: [[join(root, "allowed", "alice.ts")]],
		});
	});
});
