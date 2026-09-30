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
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/hooks/use-claude-events";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {SSE_EVENTS} from "../src/lib/hook-events";
import {findLaunchedSession, startSessionProjects} from "../src/lib/palette-start-session";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

class TestEventSource extends EventTarget {
	static current: TestEventSource | null = null;

	readonly close = vi.fn();
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

let launchCalls: LaunchCall[] = [];
let launchResponse: () => Promise<Response> = () => new Promise<Response>(() => {});

function fetchMock(url: string, init?: RequestInit): Promise<Response> {
	if (url === "/api/herdr/launch") {
		launchCalls.push({url, init});
		return launchResponse();
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
	return [...dialog.querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent ?? "");
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
	await waitFor(() => expect(headings(dialog)).toStrictEqual(["Choose a project"]));
	const row = [...dialog.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
		(item) => item.querySelector("[data-palette-label]")?.textContent === name,
	);
	if (row === undefined) throw new Error(`No project row ${name}`);
	fireEvent.click(row);
}

describe("⌘K palette: start a new session", () => {
	const writeText = vi.fn((_text: string) => Promise.resolve());

	beforeEach(() => {
		launchCalls = [];
		launchResponse = () => new Promise<Response>(() => {});
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
	});

	it("hides Quick actions while the query is empty", async () => {
		const {dialog} = await openPalette();

		expect(headings(dialog)).toStrictEqual(["Recents", "Actions"]);
	});

	it("prepends a selected New session row with the prompt and a project chip once text is typed", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: "fix the flaky test"}});

		expect(headings(dialog)[0]).toBe("Quick actions");
		expect(groupLabels(dialog, "Quick actions")).toStrictEqual(["New session"]);
		const row = newSessionRow(dialog);
		expect({
			prompt: row.querySelector("[data-palette-prompt]")?.textContent,
			project: row.querySelector("[data-palette-project-chip]")?.textContent,
			selected: row.getAttribute("data-selected"),
		}).toStrictEqual({prompt: "fix the flaky test", project: "it's", selected: "true"});
	});

	it("does not offer New session for the / filter hints", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.change(input, {target: {value: "/"}});

		expect(dialog.querySelector('[data-value="start:new-session"]')).toBeNull();
	});

	it("opens a project picker with recents' projects first on Enter", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "fix the flaky test"}});

		fireEvent.keyDown(input, {key: "Enter", code: "Enter"});

		await waitFor(() => expect(headings(dialog)).toStrictEqual(["Choose a project"]));
		expect(groupLabels(dialog, "Choose a project")).toStrictEqual(["it's", "older", "newest"]);
		expect(dialog.querySelector('[cmdk-item][data-selected="true"]')?.textContent).toBe("it's");
		expect(launchCalls).toStrictEqual([]);
	});

	it("opens the picker on ⌘⏎ even when another row is selected", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "auth"}});
		fireEvent.keyDown(input, {key: "ArrowDown", code: "ArrowDown"});

		fireEvent.keyDown(input, {key: "Enter", code: "Enter", metaKey: true});

		await waitFor(() => expect(headings(dialog)).toStrictEqual(["Choose a project"]));
	});

	it("returns from the picker to the results on Escape", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "fix the flaky test"}});
		fireEvent.keyDown(input, {key: "Enter", code: "Enter"});
		await waitFor(() => expect(headings(dialog)).toStrictEqual(["Choose a project"]));

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});

		await waitFor(() => expect(headings(dialog)[0]).toBe("Quick actions"));
		expect(screen.getByRole("dialog", {name: "Search"})).toBe(dialog);
		await waitFor(() => expect(newSessionRow(dialog).getAttribute("data-selected")).toBe("true"));
	});

	it("posts the prompt and project to the herdr launch API and shows Starting session…", async () => {
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "fix the flaky test"}});

		await pickProject(dialog, input, "older");

		await waitFor(() => expect(launchCalls.length).toBe(1));
		expect({
			method: launchCalls[0]?.init?.method,
			body: launchBody(launchCalls[0]),
		}).toStrictEqual({
			method: "POST",
			body: {cwd: "/users/dev/older", prompt: "fix the flaky test"},
		});
		expect(groupLabels(dialog, "Quick actions")).toStrictEqual(["Starting session…"]);
		expect(within(dialog).getByRole("combobox")).toHaveProperty("disabled", true);
	});

	it("navigates to the new session when SessionStart for that cwd arrives", async () => {
		launchResponse = async () => Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null});
		const {dialog, input, router, eventSource} = await openPalette();
		fireEvent.change(input, {target: {value: "fix the flaky test"}});
		await pickProject(dialog, input, "older");
		await waitFor(() => expect(launchCalls.length).toBe(1));

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

		await waitFor(() => expect(router.state.location.pathname).toBe("/session/new-session"));
		await waitFor(() => expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull());
	});

	it("copies the exact shell-escaped command when herdr is unavailable", async () => {
		launchResponse = async () => Response.json({error: "herdr writes are disabled"}, {status: 403});
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "don't break $HOME"}});

		await pickProject(dialog, input, "it's");

		await waitFor(() =>
			expect(writeText.mock.calls).toStrictEqual([
				[`cd '/users/dev/it'\\''s' && claude 'don'\\''t break $HOME'`],
			]),
		);
		expect((await screen.findByRole("status")).textContent).toContain("Copied command — herdr unavailable");
	});

	it("falls back to copying when the launch request itself fails", async () => {
		launchResponse = () => Promise.reject(new TypeError("Failed to fetch"));
		const {dialog, input} = await openPalette();
		fireEvent.change(input, {target: {value: "hello"}});

		await pickProject(dialog, input, "newest");

		await waitFor(() => expect(writeText.mock.calls).toStrictEqual([["cd '/users/dev/newest' && claude 'hello'"]]));
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
});
