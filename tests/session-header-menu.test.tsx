// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {SESSION_MENU_CAPABILITIES} from "../src/components/session-actions-menu";
import {SessionPage} from "../src/components/session-page";
import {SettingsProvider} from "../src/components/settings-provider";
import {
	SessionTitlebar,
	type SessionHeaderLocalActions,
	type SessionHeaderTranscriptView,
} from "../src/components/session-titlebar";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions, type HerdrPaneIndexData} from "../src/lib/api/herdr";
import {
	sessionDetailQueryOptions,
	sessionOpenInQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {getSessionMenuItems, type SessionMenuEntry} from "../src/lib/session-menu-items";
import {__unreadStoreTesting} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";

// session-chat pulls in HMR-persisted module state that jsdom cannot evaluate.
vi.mock("../src/components/session-chat", () => ({
	SessionChat: () => null,
}));

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const TITLE = "Sync fork with upstream";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";
const RESUME_COMMAND = `cd '${PROJECT_PATH}' && claude -r ${SESSION_ID}`;
const FORK_COMMAND = `${RESUME_COMMAND} --fork-session`;

const detail: SessionDetailData = {
	title: TITLE,
	projectName: "avalonlogs",
	projectId: "-Users-alice-projects-avalonlogs",
	homeRoot: "/Users/alice",
	imageRoots: [],
	archived: false,
	summary: null,
	projectPath: PROJECT_PATH,
	gitBranch: "alice/sync-upstream",
	cwd: PROJECT_PATH,
	gitSha: null,
	gitClean: null,
	messageCount: 4,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: 3,
		lastViewedMessageIndex: 3,
		reviewTargetMessageIndex: 3,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

function livePanes(): HerdrPaneIndexData {
	return {
		panes: [
			{
				host: "herdr",
				paneId: `pane-${SESSION_ID}`,
				terminalId: "t1",
				workspaceId: "w1",
				tabId: "tab1",
				focused: false,
				cwd: null,
				foregroundCwd: null,
				agentStatus: "idle",
				agent: "claude",
				terminalTitle: null,
				agentSessionId: SESSION_ID,
				revision: 1,
				sessionId: SESSION_ID,
				via: "agent-session",
				viewedState: detail.viewedState,
			},
		],
		writesEnabled: false,
	};
}

const writeText = vi.fn<(text: string) => Promise<void>>();
const onGenerateSummary = vi.fn<() => void>();

class TestResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function localActions(overrides: Partial<SessionHeaderLocalActions> = {}): SessionHeaderLocalActions {
	return {
		resumeCommand: RESUME_COMMAND,
		forkCommand: FORK_COMMAND,
		onGenerateSummary,
		generatingSummary: false,
		...overrides,
	};
}

async function renderTitlebar(
	local: SessionHeaderLocalActions,
	{
		live = true,
		data = detail,
		bridgeSessionId = null,
		githubUrl = null,
		transcriptView,
	}: {
		live?: boolean;
		data?: SessionDetailData;
		bridgeSessionId?: string | null;
		githubUrl?: string | null;
		transcriptView?: SessionHeaderTranscriptView;
	} = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: Infinity,
				gcTime: Infinity,
				refetchOnMount: false,
			},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, live ? livePanes() : {panes: [], writesEnabled: false});
	queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
		cwd: PROJECT_PATH,
		bridgeSessionId,
		remoteControl: null,
		githubUrl,
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SessionTitlebar
						sessionId={SESSION_ID}
						data={data}
						isActive={false}
						local={local}
						{...(transcriptView === undefined ? {} : {transcriptView})}
					/>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: [`/session/${SESSION_ID}`],
		}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await flush();
	return router;
}

async function openHeaderMenu(): Promise<HTMLElement> {
	fireEvent.click(screen.getByRole("button", {name: `More options for ${TITLE}`}));
	await flush();
	return screen.getByRole("menu");
}

function menuShape(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((element) =>
		element.getAttribute("role") === "separator" ? "---" : element.textContent,
	);
}

function modelShape(entries: SessionMenuEntry[]): string[] {
	return entries.flatMap((entry) => {
		if (entry.kind === "separator") return ["---"];
		const keycap = entry.accelerator === undefined ? "" : entry.accelerator.toUpperCase();
		return [`${entry.label}${keycap}`];
	});
}

async function select(label: string) {
	await openHeaderMenu();
	fireEvent.click(screen.getByRole("menuitem", {name: label}));
	await flush();
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Promise.resolve(Response.json({ok: true}))),
	);
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	onGenerateSummary.mockReset();
	Object.defineProperty(navigator, "clipboard", {
		value: {writeText},
		configurable: true,
	});
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(async () => Promise.resolve());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("session header menu", () => {
	it("renders the upstream header model, a separator, then the local section", async () => {
		await renderTitlebar(localActions());
		const menu = await openHeaderMenu();

		const model = getSessionMenuItems(
			{
				title: TITLE,
				pinned: false,
				readState: "read",
				archived: false,
				prUrl: null,
				hasLiveTerminal: true,
				forkDisabledReason: null,
				cwd: PROJECT_PATH,
				bridgeSessionId: null,
			},
			SESSION_MENU_CAPABILITIES,
			{surface: "header"},
		);

		expect(menuShape(menu)).toStrictEqual([
			...modelShape(model),
			"---",
			"Project",
			"Copy session ID",
			"Copy resume command",
			"Copy fork command",
			"Download raw JSONL",
			"Generate AI summary",
		]);
	});

	it("wraps each section in a role=group with separators between the groups, like upstream", async () => {
		await renderTitlebar(localActions(), {
			bridgeSessionId: "cse_01ABC",
			transcriptView: {
				mode: "normal",
				defaultMode: "normal",
				hasThinking: true,
				setMode: () => {},
				makeDefault: () => {},
			},
		});
		const menu = await openHeaderMenu();
		const groups = [...menu.querySelectorAll('[role="group"]')];

		expect(
			groups.map((group) =>
				[...group.querySelectorAll('[role="menuitem"]')].map((item) => item.firstChild?.textContent),
			),
		).toStrictEqual([
			["Open in"],
			["Rename", "Fork"],
			["Copy link"],
			["Transcript view"],
			["Archive"],
			[
				"Project",
				"Copy session ID",
				"Copy resume command",
				"Copy fork command",
				"Download raw JSONL",
				"Generate AI summary",
			],
		]);
		const content = groups[0]?.parentElement;
		expect([...(content?.children ?? [])].map((child) => child.getAttribute("role"))).toStrictEqual([
			"group",
			"separator",
			"group",
			"separator",
			"group",
			"separator",
			"group",
			"separator",
			"group",
			"separator",
			"group",
		]);
	});

	it("drops Generate AI summary when there is nothing to generate", async () => {
		await renderTitlebar(localActions({onGenerateSummary: undefined}), {
			live: false,
		});
		const menu = await openHeaderMenu();
		const shape = menuShape(menu);

		expect(shape.slice(shape.lastIndexOf("---") + 1)).toStrictEqual([
			"Project",
			"Copy session ID",
			"Copy resume command",
			"Copy fork command",
			"Download raw JSONL",
		]);
	});

	it("keeps the project menu reachable in a Project submenu while the branch strip is hidden by a PR", async () => {
		const openMock = vi.fn<typeof window.open>().mockReturnValue(null);
		vi.stubGlobal("open", openMock);
		await renderTitlebar(localActions(), {
			data: {
				...detail,
				pr: {
					number: 7,
					url: "https://github.com/alice/avalonlogs/pull/7",
					repository: "alice/avalonlogs",
				},
			},
		});
		await openHeaderMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Project"}));
		await flush();
		const submenu = screen.getAllByRole("menu").at(-1);
		const items = [...(submenu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) => item.textContent);
		fireEvent.click(screen.getByRole("menuitem", {name: "Open repository on GitHub"}));
		await flush();

		expect({items, opened: openMock.mock.calls}).toStrictEqual({
			items: ["Open in Finder", "Copy path", "Copy branch name", "Open repository on GitHub"],
			opened: [["https://github.com/alice/avalonlogs", "_blank", "noopener,noreferrer"]],
		});
	});

	it("opens the checkout's GitHub origin from the Project submenu when the session has no PR", async () => {
		const openMock = vi.fn<typeof window.open>().mockReturnValue(null);
		vi.stubGlobal("open", openMock);
		await renderTitlebar(localActions(), {githubUrl: "https://github.com/alice/origin-repo"});
		await openHeaderMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Project"}));
		await flush();
		const submenu = screen.getAllByRole("menu").at(-1);
		const items = [...(submenu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) => item.textContent);
		fireEvent.click(screen.getByRole("menuitem", {name: "Open repository on GitHub"}));
		await flush();

		expect({items, opened: openMock.mock.calls}).toStrictEqual({
			items: ["Open in Finder", "Copy path", "Copy branch name", "Open repository on GitHub"],
			opened: [["https://github.com/alice/origin-repo", "_blank", "noopener,noreferrer"]],
		});
	});

	it("shows a pending summary as a disabled item", async () => {
		await renderTitlebar(localActions({generatingSummary: true}));
		await openHeaderMenu();

		const item = screen.getByRole("menuitem", {name: "Generating summary…"});
		expect(item.getAttribute("aria-disabled")).toBe("true");
	});

	it("wires each local item to its handler", async () => {
		const clicks: Array<{href: string; download: string}> = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			clicks.push({
				href: this.getAttribute("href") ?? "",
				download: this.download,
			});
		});
		await renderTitlebar(localActions());

		await select("Copy session ID");
		await select("Copy resume command");
		await select("Copy fork command");
		await select("Download raw JSONL");
		await select("Generate AI summary");

		expect({
			clipboard: writeText.mock.calls,
			downloads: clicks,
			summaryRequests: onGenerateSummary.mock.calls.length,
		}).toStrictEqual({
			clipboard: [[SESSION_ID], [RESUME_COMMAND], [FORK_COMMAND]],
			downloads: [{href: `/api/raw?sessionId=${SESSION_ID}`, download: ""}],
			summaryRequests: 1,
		});
	});

	it("opens the same menu at the pointer when the title is right-clicked", async () => {
		await renderTitlebar(localActions());
		const chevronShape = menuShape(await openHeaderMenu());
		fireEvent.keyDown(screen.getByRole("menu"), {key: "Escape"});
		await flush();

		fireEvent.contextMenu(screen.getByRole("button", {name: `${TITLE}, rename session`}), {
			clientX: 232,
			clientY: 27,
		});
		await flush();
		const menu = screen.getByRole("menu");

		expect({
			kind: menu.getAttribute("data-cds"),
			shape: menuShape(menu),
		}).toStrictEqual({
			kind: "ContextMenu",
			shape: chevronShape,
		});
	});

	it("renames inline from the title's context menu", async () => {
		await renderTitlebar(localActions());

		fireEvent.contextMenu(screen.getByRole("button", {name: `${TITLE}, rename session`}), {
			clientX: 232,
			clientY: 27,
		});
		await flush();
		fireEvent.click(screen.getByRole("menuitem", {name: /^Rename/}));
		await flush();
		await flush();

		expect({
			menus: screen.queryAllByRole("menu").length,
			input: screen.getByRole<HTMLInputElement>("textbox").value,
		}).toStrictEqual({menus: 0, input: TITLE});
	});
});

describe("session header menu on a coarse pointer under 640px", () => {
	function stubCoarsePointer() {
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

	const transcriptView: SessionHeaderTranscriptView = {
		mode: "normal",
		defaultMode: "normal",
		hasThinking: true,
		setMode: () => {},
		makeDefault: () => {},
	};

	async function openSheet(): Promise<HTMLElement> {
		stubCoarsePointer();
		await renderTitlebar(localActions(), {bridgeSessionId: "cse_01ABC", transcriptView});
		fireEvent.click(screen.getByRole("button", {name: `More options for ${TITLE}`}));
		// The sheet presentation is its own lazily loaded chunk.
		const menu = (await screen.findAllByRole("menu")).at(-1);
		if (menu === undefined) throw new Error("no menu");
		return menu;
	}

	async function drill(root: HTMLElement, trigger: string) {
		fireEvent.click(screen.getByRole("menuitem", {name: trigger}));
		await flush();
		const child = [...document.querySelectorAll<HTMLElement>("[role=menu]")].find((menu) => menu !== root);
		const header = child?.querySelector("[data-cds-sheet-scroll]")?.nextElementSibling;
		return {
			presentation: child?.getAttribute("data-presentation"),
			drilled: root.hasAttribute("data-cds-sheet-drilled"),
			back: header?.querySelector("[aria-label=Back]")?.getAttribute("role"),
			title: header?.lastElementChild?.textContent,
		};
	}

	it("presents the header menu as a bottom sheet with a handle and a Close row", async () => {
		const menu = await openSheet();
		const rows = menu.querySelectorAll("[role=menuitem]");

		expect({
			presentation: menu.getAttribute("data-presentation"),
			size: menu.getAttribute("data-size"),
			density: menu.parentElement?.getAttribute("data-density"),
			row: ["min-h-10", "text-[15px]/[22px]"].filter((name) => rows.item(0).classList.contains(name)),
			handle: menu.firstElementChild?.hasAttribute("data-cds-sheet-handle"),
			lastRow: rows.item(rows.length - 1).getAttribute("aria-label"),
			scrim: document.querySelector("[data-sheet-scrim]") !== null,
		}).toStrictEqual({
			presentation: "sheet",
			size: "lg",
			density: "comfortable",
			row: ["min-h-10", "text-[15px]/[22px]"],
			handle: true,
			lastRow: "Close",
			scrim: true,
		});
	});

	it("drills Open in into the sheet behind a Back header titled Open in", async () => {
		const root = await openSheet();

		expect(await drill(root, "Open in")).toStrictEqual({
			presentation: "sheet",
			drilled: true,
			back: "menuitem",
			title: "Open in",
		});
	});

	it("drills Transcript view into the sheet behind a Back header titled Transcript view", async () => {
		const root = await openSheet();

		expect(await drill(root, "Transcript view")).toStrictEqual({
			presentation: "sheet",
			drilled: true,
			back: "menuitem",
			title: "Transcript view",
		});
	});
});

class TestEventSource extends EventTarget {
	readonly close = vi.fn<() => void>();
	onerror: ((event: Event) => void) | null = null;
}

class TestIntersectionObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

async function renderSessionPage() {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false}},
	});
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, detail);
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records: [],
		byteOffset: 0,
		startIndex: 0,
		precedingMessageCount: 0,
		hiddenUuids: [],
		cuts: [],
		chainVersion: "v1",
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, []);
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, livePanes());
	queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
		cwd: PROJECT_PATH,
		bridgeSessionId: null,
		remoteControl: null,
		githubUrl: null,
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ClaudeEventsProvider>
						<ToastProvider>
							<SessionPage sessionId={SESSION_ID} />
						</ToastProvider>
					</ClaudeEventsProvider>
				</SettingsProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: [`/session/${SESSION_ID}`],
		}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByTestId("session-titlebar");
	await flush();
}

describe("session page header", () => {
	it("moves the local icon buttons into the chevron menu", async () => {
		vi.stubGlobal("EventSource", TestEventSource);
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);

		await renderSessionPage();
		const removedIcons = [
			"Copy session ID",
			"Copy resume command",
			"Copy fork command",
			"Download raw JSONL",
			"Star session",
			"Mark reviewed",
			"Mark unreviewed",
			`Open live read-only terminal for ${TITLE}`,
		].filter((name) => screen.queryByTitle(name) !== null);
		const summaryButton = screen.queryByRole("button", {
			name: "Generate AI summary",
		});
		const menu = await openHeaderMenu();
		const shape = menuShape(menu);

		expect({
			removedIcons,
			summaryButton,
			local: shape.slice(shape.lastIndexOf("---") + 1),
		}).toStrictEqual({
			removedIcons: [],
			summaryButton: null,
			local: [
				"Project",
				"Copy session ID",
				"Copy resume command",
				"Copy fork command",
				"Download raw JSONL",
				"Generate AI summary",
			],
		});
	});
});
