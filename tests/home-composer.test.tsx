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
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {HOME_RECENT_LIMIT, HomeComposer} from "../src/components/home/home-composer";
import {NewSessionShortcut} from "../src/components/new-session-shortcut";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/hooks/use-claude-events";
import {composerDefaultsQueryOptions} from "../src/lib/api/composer-defaults";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {getComposerDefaults} from "../src/lib/composer-state";
import {SSE_EVENTS} from "../src/lib/hook-events";
import {installLocalStorage} from "./fake-storage";

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

function recentSession(id: string, project: string, projectName: string) {
	return {
		id,
		title: id,
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
];

const RECENTS = [recentSession("sess-1", "-users-dev-it-s", "it's")];

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

async function renderApp(initialPath = "/", settingsModel: string | null = "claude-opus-4-8[1m]") {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(recentSessionsQueryOptions(HOME_RECENT_LIMIT).queryKey, {
		sessions: RECENTS,
		nextCursor: null,
	});
	queryClient.setQueryData(projectsQueryOptions().queryKey, PROJECTS);
	queryClient.setQueryData(composerDefaultsQueryOptions.queryKey, {
		model: settingsModel,
		effortLevel: "medium",
		defaultMode: "plan",
		bypassPermissionsAllowed: false,
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ClaudeEventsProvider>
					<ToastProvider>
						<NewSessionShortcut />
						<Outlet />
					</ToastProvider>
				</ClaudeEventsProvider>
			</QueryClientProvider>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: HomeComposer,
	});
	const elsewhereRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "elsewhere",
		component: () => <button type="button">Elsewhere</button>,
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, elsewhereRoute, sessionRoute]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const eventSource = TestEventSource.current;
	if (eventSource === null) throw new Error("Expected ClaudeEventsProvider to open EventSource");
	return {router, eventSource};
}

function launchBody(call: LaunchCall | undefined): unknown {
	return JSON.parse(String(call?.init?.body));
}

async function typePrompt(text: string) {
	const textarea = await screen.findByRole("textbox", {name: "Prompt"});
	fireEvent.change(textarea, {target: {value: text}});
	return textarea;
}

describe("HomeComposer", () => {
	const writeText = vi.fn((_text: string) => Promise.resolve());

	beforeEach(() => {
		launchCalls = [];
		launchResponse = () => new Promise<Response>(() => {});
		TestEventSource.current = null;
		installLocalStorage();
		vi.stubGlobal("EventSource", TestEventSource);
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		writeText.mockClear();
	});

	it("renders the upstream home composer structure with settings readouts in the chin", async () => {
		await renderApp();

		const textarea = await screen.findByRole("textbox", {name: "Prompt"});
		expect({
			placeholder: textarea.getAttribute("placeholder"),
			picker: screen.getByRole("combobox", {name: "Select project"}).textContent,
			model: screen.getByLabelText("Model: Opus 4.8").textContent,
			effort: screen.getByLabelText("Effort: Medium").textContent,
			mode: document.querySelector("[data-chin-mode]")?.textContent,
		}).toStrictEqual({
			placeholder: "Describe a task or ask a question",
			picker: "it's",
			model: "Opus 4.8",
			effort: "Medium",
			mode: "Plan",
		});
	});

	it("peeks the Clawd mascot over the composer as an unfocusable decorative button that hops on click", async () => {
		await renderApp();
		await screen.findByRole("textbox", {name: "Prompt"});

		const mascot = document.querySelector<HTMLButtonElement>("[data-clawd-mascot]");
		if (mascot === null) throw new Error("Expected the Clawd mascot on the home composer");
		const before = {
			tag: mascot.tagName,
			ariaHidden: mascot.getAttribute("aria-hidden"),
			tabIndex: mascot.getAttribute("tabindex"),
			hopping: mascot.hasAttribute("data-hopping"),
			viewBox: mascot.querySelector("svg")?.getAttribute("viewBox"),
		};
		fireEvent.click(mascot);
		const afterClick = mascot.hasAttribute("data-hopping");
		// jsdom has no AnimationEvent, so React listens for the prefixed name instead of `animationend`.
		fireEvent(mascot, new Event("webkitAnimationEnd", {bubbles: true}));

		expect({...before, afterClick, afterEnd: mascot.hasAttribute("data-hopping")}).toStrictEqual({
			tag: "BUTTON",
			ariaHidden: "true",
			tabIndex: "-1",
			hopping: false,
			viewBox: "0 0 2750 1850",
			afterClick: true,
			afterEnd: false,
		});
	});

	it("leaves the Clawd mascot off the session composer", () => {
		render(<Composer variant="session" draftKey="session-mascot" onSend={() => {}} />);

		expect({
			prompt: screen.getByRole("textbox", {name: "Prompt"}).tagName,
			mascot: document.querySelector("[data-clawd-mascot]"),
		}).toStrictEqual({prompt: "TEXTAREA", mascot: null});
	});

	it("disables Send until the prompt has text", async () => {
		await renderApp();
		const send = await screen.findByRole("button", {name: "Send"});
		expect(send).toHaveProperty("disabled", true);

		await typePrompt("   ");
		expect(send).toHaveProperty("disabled", true);

		await typePrompt("fix the flaky test");
		expect(send).toHaveProperty("disabled", false);
	});

	it("posts the prompt and the selected project to the herdr launch API", async () => {
		await renderApp();
		await typePrompt("fix the flaky test");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => expect(launchCalls.length).toBe(1));
		expect({
			url: launchCalls[0]?.url,
			method: launchCalls[0]?.init?.method,
			body: launchBody(launchCalls[0]),
		}).toStrictEqual({
			url: "/api/herdr/launch",
			method: "POST",
			body: {cwd: "/users/dev/it's", prompt: "fix the flaky test"},
		});
	});

	it("names the CLI's default model when settings.json sets none", async () => {
		await renderApp("/", null);

		const trigger = await screen.findByRole("button", {name: /^Model:/});
		expect({label: trigger.getAttribute("aria-label"), text: trigger.textContent}).toStrictEqual({
			label: "Model: Opus 5.5",
			text: "Opus 5.5",
		});
	});

	it("passes the chin's mode, model and effort choices as launch flags", async () => {
		await renderApp();
		await typePrompt("fix the flaky test");

		fireEvent.click(screen.getByRole("button", {name: "Model: Opus 4.8"}));
		fireEvent.keyDown(await screen.findByRole("menu"), {key: "3", code: "Digit3"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		fireEvent.click(document.querySelector<HTMLElement>("[data-chin-mode]")!);
		fireEvent.keyDown(await screen.findByRole("menu"), {key: "3", code: "Digit3"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => expect(launchCalls.length).toBe(1));
		expect(launchBody(launchCalls[0])).toStrictEqual({
			cwd: "/users/dev/it's",
			prompt: "fix the flaky test",
			args: ["--permission-mode", "acceptEdits", "--model", "sonnet"],
		});
	});

	it("launches in the project chosen from the picker", async () => {
		await renderApp();
		fireEvent.click(screen.getByRole("combobox", {name: "Select project"}));
		fireEvent.click(await screen.findByRole("option", {name: "newest"}));
		await waitFor(() => expect(screen.getByRole("combobox", {name: "Select project"}).textContent).toBe("newest"));
		await typePrompt("hello");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => expect(launchCalls.length).toBe(1));
		expect(launchBody(launchCalls[0])).toStrictEqual({cwd: "/users/dev/newest", prompt: "hello"});
	});

	it("opens a searchable repository picker from the project chip", async () => {
		await renderApp();
		const chip = screen.getByRole("combobox", {name: "Select project"});
		expect({
			haspopup: chip.getAttribute("aria-haspopup"),
			expanded: chip.getAttribute("aria-expanded"),
		}).toStrictEqual({haspopup: "dialog", expanded: "false"});

		fireEvent.click(chip);
		const search = await screen.findByRole("textbox", {name: "Search projects"});
		await waitFor(() => expect(document.activeElement).toBe(search));
		expect(search.getAttribute("placeholder")).toBe("Search projects…");
		expect(
			screen.getAllByRole("option").map((option) => ({
				name: option.textContent,
				selected: option.getAttribute("aria-selected"),
			})),
		).toStrictEqual([
			{name: "it's", selected: "true"},
			{name: "newest", selected: "false"},
		]);

		fireEvent.change(search, {target: {value: "dev/new"}});
		expect(screen.getAllByRole("option").map((option) => option.textContent)).toStrictEqual(["newest"]);

		fireEvent.change(search, {target: {value: ""}});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "Enter"});

		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
		expect(chip.textContent).toBe("newest");
	});

	it("navigates to the new session when its SessionStart arrives over SSE", async () => {
		launchResponse = async () => Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null});
		const {router, eventSource} = await renderApp();
		await typePrompt("fix the flaky test");
		fireEvent.click(screen.getByRole("button", {name: "Send"}));
		await waitFor(() => expect(launchCalls.length).toBe(1));

		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {
				sessionId: "other",
				cwd: "/users/dev/newest",
				model: "",
			});
		});
		expect(router.state.location.pathname).toBe("/");

		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {
				sessionId: "new-session",
				cwd: "/users/dev/it's",
				model: "",
			});
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/session/new-session"));
	});

	it("navigates to the new session after a plain Enter send", async () => {
		launchResponse = async () => Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null});
		const {router, eventSource} = await renderApp();
		const textarea = await typePrompt("fix the flaky test");

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter"});
		await waitFor(() => expect(launchCalls.length).toBe(1));
		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {sessionId: "new-session", cwd: "/users/dev/it's", model: ""});
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/session/new-session"));
	});

	it("sends with ⌘⏎ and stays home with a cleared prompt and a success toast", async () => {
		launchResponse = async () => Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: "stay-session"});
		const {router, eventSource} = await renderApp();
		const textarea = await typePrompt("fix the flaky test");

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true});

		await waitFor(() => expect(launchCalls.length).toBe(1));
		expect(launchBody(launchCalls[0])).toStrictEqual({cwd: "/users/dev/it's", prompt: "fix the flaky test"});
		expect((await screen.findByRole("status")).textContent).toContain("Started a session in it's");
		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {sessionId: "stay-session", cwd: "/users/dev/it's", model: ""});
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect({path: router.state.location.pathname, prompt: (textarea as HTMLTextAreaElement).value}).toStrictEqual({
			path: "/",
			prompt: "",
		});
	});

	it("shows Send and stay here ⌘⏎ under Send in the tooltip", async () => {
		await renderApp();
		await typePrompt("hello");

		fireEvent.pointerEnter(screen.getByRole("button", {name: "Send"}));
		const tooltip = await screen.findByRole("tooltip");

		expect([...tooltip.children].map((row) => row.textContent)).toStrictEqual([
			"Send⏎Enter",
			"Send and stay here⌘Command⏎Enter",
		]);
	});

	it("copies the shell-escaped command with a toast when herdr is unavailable", async () => {
		launchResponse = async () => Response.json({error: "herdr writes are disabled"}, {status: 403});
		await renderApp();
		await typePrompt("don't break $HOME");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() =>
			expect(writeText.mock.calls).toStrictEqual([
				[`cd '/users/dev/it'\\''s' && claude 'don'\\''t break $HOME'`],
			]),
		);
		expect((await screen.findByRole("status")).textContent).toContain("Copied command — herdr unavailable");
	});

	it("focuses the composer on ⇧⌘O while already home", async () => {
		await renderApp();
		const textarea = await screen.findByRole("textbox", {name: "Prompt"});
		const picker = screen.getByRole("combobox", {name: "Select project"});
		picker.focus();
		expect(document.activeElement).toBe(picker);

		fireEvent.keyDown(picker, {key: "O", code: "KeyO", metaKey: true, shiftKey: true});

		await waitFor(() => expect(document.activeElement).toBe(textarea));
	});

	it("navigates home and focuses the composer on ⇧⌘O from another page", async () => {
		const {router} = await renderApp("/elsewhere");
		const elsewhere = await screen.findByRole("button", {name: "Elsewhere"});

		fireEvent.keyDown(elsewhere, {key: "O", code: "KeyO", metaKey: true, shiftKey: true});

		await waitFor(() => expect(router.state.location.pathname).toBe("/"));
		const textarea = await screen.findByRole("textbox", {name: "Prompt"});
		await waitFor(() => expect(document.activeElement).toBe(textarea));
	});
});

describe("getComposerDefaults", () => {
	it("reads model, effort and default mode from settings.json", async () => {
		expect(
			await getComposerDefaults(async () => ({
				model: "opus",
				effortLevel: "xhigh",
				permissions: {defaultMode: "acceptEdits"},
			})),
		).toStrictEqual({
			model: "opus",
			effortLevel: "xhigh",
			defaultMode: "acceptEdits",
			bypassPermissionsAllowed: false,
		});
	});

	it("returns nulls when settings.json is missing", async () => {
		expect(
			await getComposerDefaults(async () => {
				throw new Error("ENOENT");
			}),
		).toStrictEqual({
			model: null,
			effortLevel: null,
			defaultMode: null,
			bypassPermissionsAllowed: false,
		});
	});
});
