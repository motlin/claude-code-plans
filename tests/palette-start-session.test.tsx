// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette, PALETTE_RECENT_LIMIT, PALETTE_SEARCH_DEBOUNCE_MS} from "../src/components/command-palette";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {SSE_EVENTS} from "../src/lib/hook-events";
import {findLaunchedSession, startSessionProjects} from "../src/lib/palette-start-session";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

class TestEventSource extends EventTarget {
	static current: TestEventSource | null = null;

	readonly close = vi.fn<() => void>();
	onerror: ((event: Event) => void) | null = null;

	constructor(readonly url: string | URL) {
		super();
		TestEventSource.current = this;
	}

	emit(type: string, data: Record<string, unknown> = {}): void {
		this.dispatchEvent(new MessageEvent(type, {data: JSON.stringify(data)}));
	}
}

function recentSession(id: string, title: string, project: string, projectName: string) {
	return {
		id,
		title,
		summary: undefined,
		mtime: new Date().toISOString(),
		created: new Date(0).toISOString(),
		project,
		projectName,
		messageCount: 1,
		gitBranch: undefined,
		archived: false,
		state: "unknown" as const,
		bucket: "done" as const,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

function project(id: string, name: string, projectPath: string | null, lastActivity: string) {
	return {
		id,
		name,
		projectPath,
		sessionCount: 1,
		memoryCount: 0,
		planCount: 0,
		taskCount: 0,
		activeCount: 0,
		lastActivity,
	};
}

const PROJECTS = [
	project("-users-dev-newest", "newest", "/users/dev/newest", "2026-09-29T00:00:00.000Z"),
	project("-users-dev-it-s", "it's", "/users/dev/it's", "2026-09-01T00:00:00.000Z"),
	project("-users-dev-gone", "gone", null, "2026-09-28T00:00:00.000Z"),
	project("-users-dev-older", "older", "/users/dev/older", "2026-08-01T00:00:00.000Z"),
];

const RECENTS = [
	recentSession("sess-1", "Refactor auth module", "-users-dev-it-s", "it's"),
	recentSession("sess-2", "Tune the indexer", "-users-dev-older", "older"),
	recentSession("sess-3", "Another it's session", "-users-dev-it-s", "it's"),
];

interface LaunchCall {
	url: string;
	init: RequestInit | undefined;
}

// Upstream offers the Quick actions New session row only above 50 raw characters.
const LONG_PROMPT = "fix the flaky test in the palette search spec please now";

let launchCalls: LaunchCall[] = [];
let fetchedUrls: string[] = [];
let launchResponse: () => Promise<Response> = async () => new Promise<Response>(() => {});

async function fetchMock(url: string, init?: RequestInit): Promise<Response> {
	fetchedUrls.push(url);
	if (url === "/api/herdr/launch") {
		launchCalls.push({url, init});
		return launchResponse();
	}
	if (url === "/api/attachments") {
		return Promise.resolve(
			Response.json({path: "/cache/attachments/uuid.txt", name: "notes.txt", mediaType: "text/plain", size: 5}),
		);
	}
	return new Promise<Response>(() => {});
}

function Harness() {
	const palette = useCommandPalette();
	return (
		<>
			<textarea aria-label="Composer" />
			<CommandPalette {...palette} />
		</>
	);
}

async function openPalette() {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
		sessions: RECENTS,
		nextCursor: null,
	});
	queryClient.setQueryData(projectsQueryOptions().queryKey, PROJECTS);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ClaudeEventsProvider>
					<ToastProvider>
						<Harness />
						<Outlet />
					</ToastProvider>
				</ClaudeEventsProvider>
			</QueryClientProvider>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
	const searchRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "search",
		validateSearch: (search: Record<string, unknown>) => search,
		component: () => null,
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, searchRoute, sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const composer = await screen.findByRole("textbox", {name: "Composer"});
	composer.focus();
	fireEvent.keyDown(composer, {key: "k", code: "KeyK", metaKey: true});
	const dialog = await screen.findByRole("dialog", {name: "Search"});
	const eventSource = TestEventSource.current;
	if (eventSource === null) throw new Error("Expected ClaudeEventsProvider to open EventSource");
	return {dialog, router, eventSource, input: within(dialog).getByRole("combobox")};
}

function headings(dialog: HTMLElement): string[] {
	return [...dialog.querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent);
}

function groupLabels(dialog: HTMLElement, heading: string): string[] {
	const group = [...dialog.querySelectorAll("[cmdk-group]")].find(
		(g) => g.querySelector("[cmdk-group-heading]")?.textContent === heading,
	);
	if (group === undefined) throw new Error(`No group headed ${heading}`);
	return [...group.querySelectorAll("[cmdk-item]")].map(
		(item) => item.querySelector("[data-palette-label]")?.textContent ?? "",
	);
}

function newSessionRow(dialog: HTMLElement): HTMLElement {
	const row = dialog.querySelector<HTMLElement>('[cmdk-item][data-value="start:new-session"]');
	if (row === null) throw new Error("No New session row");
	return row;
}

function launchBody(call: LaunchCall | undefined): unknown {
	return JSON.parse(String(call?.init?.body));
}

async function pickProject(dialog: HTMLElement, input: HTMLElement, name: string) {
	fireEvent.keyDown(input, {key: "Enter", code: "Enter"});
	await waitFor(() => {
		expect(headings(dialog)).toStrictEqual(["Choose a project"]);
	});
	const row = [...dialog.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
		(item) => item.querySelector("[data-palette-label]")?.textContent === name,
	);
	if (row === undefined) throw new Error(`No project row ${name}`);
	fireEvent.click(row);
}

describe("⌘K palette: start a new session", () => {
	const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => Promise.resolve());

	beforeEach(() => {
		launchCalls = [];
		fetchedUrls = [];
		launchResponse = async () => new Promise<Response>(() => {});
		TestEventSource.current = null;
		vi.stubGlobal("EventSource", TestEventSource);
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		Element.prototype.scrollIntoView = () => {};
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		writeText.mockClear();
		// The palette remembers its last mode in localStorage, which jsdom keeps for the whole file.
		localStorage.clear();
	});

	it("hides Quick actions while the query is empty", async () => {
		const {dialog} = await openPalette();

		expect(headings(dialog)).toStrictEqual(["Recents", "Actions"]);
	});

	it("offers a selected New session row only once the query is longer than 50 characters", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: "fix the flaky test"}});
		const shortHeadings = headings(dialog);
		fireEvent.change(input, {target: {value: "x".repeat(51)}});

		expect({
			shortHasQuickActions: shortHeadings.includes("Quick actions"),
			longHeadings: headings(dialog),
			longItems: [...dialog.querySelectorAll("[cmdk-item]")].map((item) => item.getAttribute("data-value")),
			selected: newSessionRow(dialog).getAttribute("data-selected"),
		}).toStrictEqual({
			shortHasQuickActions: false,
			longHeadings: ["Quick actions"],
			longItems: ["start:new-session"],
			selected: "true",
		});
	});

	it("renders upstream's send_message row: ChatAdd-like icon, the quoted prompt inline at 50% opacity, and a project chip", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: LONG_PROMPT}});

		const row = newSessionRow(dialog);
		expect({
			label: row.querySelector("[data-palette-label]")?.textContent,
			labelClass: row.querySelector("[data-palette-label]")?.className,
			promptClass: row.querySelector("[data-palette-prompt]")?.className,
			promptHtml: row.querySelector("[data-palette-prompt]")?.innerHTML,
			icon: row.querySelector("svg")?.classList.contains("lucide-message-square-plus"),
			project: row.querySelector("[data-palette-project-chip]")?.textContent,
		}).toStrictEqual({
			label: `New session“${LONG_PROMPT}”`,
			labelClass: "truncate",
			promptClass: "opacity-50 ms-1.5",
			promptHtml: `<span dir="auto"><span class="opacity-50">“</span>${LONG_PROMPT}<span class="opacity-50">”</span></span>`,
			icon: true,
			project: "it's",
		});
	});

	it("puts upstream's 24px brand-filled enter cap on the selected New session row", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: LONG_PROMPT}});

		const row = newSessionRow(dialog);
		const cap = row.querySelector("[data-palette-enter-cap]");
		expect({
			selected: row.getAttribute("data-selected"),
			wrapperClass: cap?.parentElement?.parentElement?.className,
			coarseClass: cap?.parentElement?.className,
			capClass: cap?.className,
			glyph: cap?.querySelector("svg")?.getAttribute("class"),
		}).toStrictEqual({
			selected: "true",
			wrapperClass: "hidden shrink-0 items-center text-xs text-ink-muted group-data-[selected=true]:flex",
			coarseClass: "pointer-coarse:hidden",
			capClass: "-my-1 -me-1.5 flex size-6 items-center justify-center rounded-r5 bg-brand-100 text-oncolor-100",
			glyph: "lucide lucide-corner-down-left size-4",
		});
	});

	it("quotes the raw query on the New session row, keeping a trailing space as upstream does", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: `${"a".repeat(50)} `}});

		expect(newSessionRow(dialog).querySelector("[data-palette-label]")?.textContent).toStrictEqual(
			`New session“${"a".repeat(50)} ”`,
		);
	});

	it("skips search above 50 characters: no /api/search request, no See all row, an empty live region", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: `auth ${"x".repeat(46)}`}});
		await new Promise((resolve) => {
			setTimeout(resolve, PALETTE_SEARCH_DEBOUNCE_MS * 3);
		});

		expect({
			searches: fetchedUrls.filter((url) => url.startsWith("/api/search")),
			seeAll: dialog.querySelector('[data-value^="see-all"]'),
			live: dialog.querySelector("[aria-live]")?.textContent,
			items: [...dialog.querySelectorAll("[cmdk-item]")].map((item) => item.getAttribute("data-value")),
		}).toStrictEqual({searches: [], seeAll: null, live: "", items: ["start:new-session"]});
	});

	it("counts the raw query: 50 letters plus a trailing space offers the row, 50 letters do not", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: "a".repeat(50)}});
		const at50 = dialog.querySelector('[data-value="start:new-session"]');
		fireEvent.change(input, {target: {value: `${"a".repeat(50)} `}});

		expect({at50, withSpace: newSessionRow(dialog).getAttribute("data-value")}).toStrictEqual({
			at50: null,
			withSpace: "start:new-session",
		});
	});

	it("keeps only the New session row for a long prompt on a type tab", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.keyDown(input, {key: "ArrowRight", code: "ArrowRight"});

		fireEvent.change(input, {target: {value: LONG_PROMPT}});

		expect(
			[...dialog.querySelectorAll("[cmdk-item]")].map((item) => item.getAttribute("data-value")),
		).toStrictEqual(["start:new-session"]);
	});

	it("does not offer New session for the / filter hints", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: "/"}});

		expect(dialog.querySelector('[data-value="start:new-session"]')).toBeNull();
	});

	it("opens a project picker with recents' projects first on Enter", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: LONG_PROMPT}});

		fireEvent.keyDown(input, {key: "Enter", code: "Enter"});

		await waitFor(() => {
			expect(headings(dialog)).toStrictEqual(["Choose a project"]);
		});
		expect(groupLabels(dialog, "Choose a project")).toStrictEqual(["it's", "older", "newest"]);
		expect(dialog.querySelector('[cmdk-item][data-selected="true"]')?.textContent).toBe("it's");
		expect(launchCalls).toStrictEqual([]);
	});

	it("opens the picker on ⌘⏎ even when another row is selected", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "auth"}});
		fireEvent.keyDown(input, {key: "ArrowDown", code: "ArrowDown"});

		fireEvent.keyDown(input, {key: "Enter", code: "Enter", metaKey: true});

		await waitFor(() => {
			expect(headings(dialog)).toStrictEqual(["Choose a project"]);
		});
	});

	it("returns from the picker to the results on Escape", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: LONG_PROMPT}});
		fireEvent.keyDown(input, {key: "Enter", code: "Enter"});
		await waitFor(() => {
			expect(headings(dialog)).toStrictEqual(["Choose a project"]);
		});

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(headings(dialog)[0]).toBe("Quick actions");
		});
		expect(screen.getByRole("dialog", {name: "Search"})).toBe(dialog);
		await waitFor(() => {
			expect(newSessionRow(dialog).getAttribute("data-selected")).toBe("true");
		});
	});

	it("posts the prompt and project to the herdr launch API and shows Starting session…", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: LONG_PROMPT}});

		await pickProject(dialog, input, "older");

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect({
			method: launchCalls[0]?.init?.method,
			body: launchBody(launchCalls[0]),
		}).toStrictEqual({
			method: "POST",
			body: {cwd: "/users/dev/older", prompt: LONG_PROMPT},
		});
		expect(groupLabels(dialog, "Quick actions")).toStrictEqual(["Starting session…"]);
		expect(within(dialog).getByRole("combobox")).toHaveProperty("disabled", true);
	});

	it("launches Compose attachments as chips ahead of the prompt", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		const fileInput = dialog.querySelector<HTMLInputElement>('input[type="file"]');
		if (fileInput === null) throw new Error("No file input");
		fireEvent.change(fileInput, {target: {files: [new File(["hello"], "notes.txt", {type: "text/plain"})]}});
		await within(dialog).findByRole("button", {name: "Remove notes.txt"});
		fireEvent.change(composer, {target: {value: "summarize this"}});

		fireEvent.click(within(dialog).getByRole("button", {name: "Send"}));
		await waitFor(() => {
			expect(headings(dialog)).toStrictEqual(["Choose a project"]);
		});
		const row = [...dialog.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
			(item) => item.querySelector("[data-palette-label]")?.textContent === "older",
		);
		if (row === undefined) throw new Error("No project row older");
		fireEvent.click(row);

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(launchBody(launchCalls[0])).toStrictEqual({
			cwd: "/users/dev/older",
			prompt: "@/cache/attachments/uuid.txt\n\nsummarize this",
		});
	});

	it("disables Compose's Search Tab view hint while launching", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		fireEvent.change(composer, {target: {value: "summarize this"}});
		fireEvent.click(within(dialog).getByRole("button", {name: "Send"}));
		await waitFor(() => {
			expect(headings(dialog)).toStrictEqual(["Choose a project"]);
		});
		const row = [...dialog.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
			(item) => item.querySelector("[data-palette-label]")?.textContent === "older",
		);
		if (row === undefined) throw new Error("No project row older");
		fireEvent.click(row);

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(within(dialog).getByRole<HTMLButtonElement>("button", {name: "Search"}).disabled).toBe(true);
	});

	it("styles Compose's launching state: dimmed textarea, busy Send, live region, no list row", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.keyDown(input, {key: "Tab", code: "Tab"});
		const composer = await within(dialog).findByRole("combobox", {name: "Write a message…"});
		fireEvent.change(composer, {target: {value: "summarize this"}});
		fireEvent.click(within(dialog).getByRole("button", {name: "Send"}));
		await waitFor(() => {
			expect(headings(dialog)).toStrictEqual(["Choose a project"]);
		});
		const row = [...dialog.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
			(item) => item.querySelector("[data-palette-label]")?.textContent === "older",
		);
		if (row === undefined) throw new Error("No project row older");
		fireEvent.click(row);

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		const send = within(dialog).getByRole<HTMLButtonElement>("button", {name: "Send"});
		const live = dialog.querySelector('[aria-live="polite"]');
		expect({
			textareaClasses: ["opacity-50", "cursor-not-allowed"].filter((name) => composer.classList.contains(name)),
			textareaDisabled: (composer as HTMLTextAreaElement).disabled,
			sendBusy: send.getAttribute("aria-busy"),
			sendDisabled: send.disabled,
			live: live?.textContent,
			headings: headings(dialog),
			listHidden: dialog.querySelector("[cmdk-list]")?.classList.contains("hidden"),
		}).toStrictEqual({
			textareaClasses: ["opacity-50", "cursor-not-allowed"],
			textareaDisabled: true,
			sendBusy: "true",
			sendDisabled: true,
			live: "Starting session…",
			headings: [],
			listHidden: true,
		});
	});

	it("navigates to the new session when SessionStart for that cwd arrives", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null}));
		const {dialog, input, router, eventSource} = await openPalette();
		fireEvent.change(input, {target: {value: LONG_PROMPT}});
		await pickProject(dialog, input, "older");
		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});

		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {
				sessionId: "other-session",
				cwd: "/users/dev/newest",
				model: "",
			});
		});
		expect(router.state.location.pathname).toBe("/");

		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {
				sessionId: "new-session",
				cwd: "/users/dev/older",
				model: "",
			});
		});

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/session/new-session");
		});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});
	});

	it("copies the exact shell-escaped command when herdr is unavailable", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({error: "herdr writes are disabled"}, {status: 403}));
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "don't break $HOME, and keep the quoting intact for the shell"}});

		await pickProject(dialog, input, "it's");

		await waitFor(() => {
			expect(writeText.mock.calls).toStrictEqual([
				[
					`cd '/users/dev/it'\\''s' && claude 'don'\\''t break $HOME, and keep the quoting intact for the shell'`,
				],
			]);
		});
		expect((await screen.findByRole("status")).textContent).toContain("Copied command — no terminal to launch in");
	});

	it("falls back to copying when the launch request itself fails", async () => {
		launchResponse = async () => Promise.reject(new TypeError("Failed to fetch"));
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "hello there, please say hello back to me from the new session"}});

		await pickProject(dialog, input, "newest");

		await waitFor(() => {
			expect(writeText.mock.calls).toStrictEqual([
				["cd '/users/dev/newest' && claude 'hello there, please say hello back to me from the new session'"],
			]);
		});
	});
});

describe("startSessionProjects", () => {
	it("puts the current session's project first, then recents' projects, then the rest by activity", () => {
		expect(
			startSessionProjects(PROJECTS, ["-users-dev-it-s", "-users-dev-gone"], "-users-dev-older").map(
				(p) => p.name,
			),
		).toStrictEqual(["older", "it's", "newest"]);
	});
});

describe("findLaunchedSession", () => {
	const launch = {cwd: "/users/dev/older/", since: 1000, sessionId: null};

	it("ignores sessions that started before the launch", () => {
		expect(findLaunchedSession([{sessionId: "old", cwd: "/users/dev/older", startedAt: 999}], launch)).toBeNull();
	});

	it("matches a fresh SessionStart in the launch cwd regardless of trailing slashes", () => {
		expect(findLaunchedSession([{sessionId: "new", cwd: "/users/dev/older", startedAt: 1000}], launch)).toBe("new");
	});

	it("matches herdr's reported session id even when the cwd differs", () => {
		expect(
			findLaunchedSession([{sessionId: "abc", cwd: "/elsewhere", startedAt: 1200}], {
				...launch,
				sessionId: "abc",
			}),
		).toBe("abc");
	});

	it("matches a fresh session in a worktree the CLI made under the launch cwd", () => {
		const worktreeLaunch = {cwd: "/p", since: 1000, sessionId: null};
		const sessions = [
			{sessionId: "early", cwd: "/p/.claude/worktrees/stale", startedAt: 999},
			{sessionId: "sibling", cwd: "/p2/.claude/worktrees/x", startedAt: 1100},
			{sessionId: "subdir", cwd: "/p/sub", startedAt: 1100},
			{sessionId: "worktree", cwd: "/p/.claude/worktrees/bright-fox", startedAt: 1200},
		];
		expect(findLaunchedSession(sessions, worktreeLaunch)).toBe("worktree");
		expect(findLaunchedSession(sessions.slice(0, 3), worktreeLaunch)).toBeNull();
	});
});
