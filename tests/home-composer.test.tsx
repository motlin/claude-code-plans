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
import {Composer} from "../src/components/composer";
import {HOME_RECENT_LIMIT, HomeComposer} from "../src/components/home/home-composer";
import {NewSessionShortcut} from "../src/components/new-session-shortcut";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {composerDefaultsQueryOptions} from "../src/lib/api/composer-defaults";
import {usageQueryOptions} from "../src/lib/api/usage";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {getComposerDefaults} from "../src/lib/composer-state";
import {requestHomeComposerPrefill} from "../src/lib/home-composer-focus";
import {SSE_EVENTS} from "../src/lib/hook-events";
import {installLocalStorage} from "./fake-storage";

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
let launchResponse: () => Promise<Response> = async () => new Promise<Response>(() => {});

async function fetchMock(url: string, init?: RequestInit): Promise<Response> {
	if (url === "/api/herdr/launch") {
		launchCalls.push({url, init});
		return launchResponse();
	}
	return new Promise<Response>(() => {});
}

async function renderApp(
	initialPath = "/",
	settingsModel: string | null = "claude-opus-4-8[1m]",
	seed: (queryClient: QueryClient) => void = () => {},
) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	seed(queryClient);
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

/** The toast's status region, not the composer's always-mounted skill-chip hint twin. */
async function findToast(): Promise<HTMLElement> {
	const statuses = await screen.findAllByRole("status");
	const toast = statuses.find((element) => !element.hasAttribute("data-skill-arg-hint-sr"));
	if (toast === undefined) throw new Error("no toast status region");
	return toast;
}

describe("HomeComposer", () => {
	const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => Promise.resolve());

	beforeEach(() => {
		launchCalls = [];
		launchResponse = async () => new Promise<Response>(() => {});
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
			picker: screen.getByRole("combobox", {name: /^Folder: /}).textContent,
			model: screen.getByLabelText("Model: Opus 4.8 Medium").textContent,
			mode: document.querySelector("[data-chin-mode]")?.textContent,
		}).toStrictEqual({
			placeholder: "Describe a task or ask a question",
			picker: "it's",
			model: "Opus 4.8 Medium",
			mode: "Plan",
		});
	});

	it("sets the usage pace banner above the composer and the folder picker in the environment bar below it when ahead of pace", async () => {
		const now = Date.now();
		await renderApp("/", "claude-opus-4-8[1m]", (queryClient) => {
			queryClient.setQueryData(
				usageQueryOptions.queryKey,
				{
					fiveHour: null,
					sevenDay: {usedPct: 50, resetsAt: now / 1000 + 6 * 24 * 3600},
					updatedAt: new Date(now).toISOString(),
				},
				{updatedAt: now},
			);
		});
		await screen.findByRole("textbox", {name: "Prompt"});
		const home = document.querySelector("[data-home-composer]");
		const order = [
			...(home?.querySelectorAll(
				"[role=combobox][aria-label^='Folder: '], [role=status]:not([data-skill-arg-hint-sr]), [data-composer-card]",
			) ?? []),
		].map((element) =>
			element.getAttribute("role") === "combobox"
				? "project"
				: element.hasAttribute("data-composer-card")
					? "composer"
					: element.textContent.startsWith("On pace")
						? "usage"
						: "other",
		);
		expect(order).toStrictEqual(["usage", "composer", "project"]);
	});

	it("renders the folder picker in upstream's wrapping environment bar under the composer card", async () => {
		await renderApp();
		await screen.findByRole("textbox", {name: "Prompt"});
		const bar = document.querySelector("[data-home-composer] [data-testid=epitaxy-environment-bar]");
		const row = bar?.querySelector("[data-testid=environment-bar-row]");
		const place = row?.firstElementChild;
		expect({
			barClass: bar?.className,
			afterCard: bar?.previousElementSibling?.hasAttribute("data-composer-card"),
			rowClass: row?.className,
			placeClass: place?.className,
			placeButton: place?.querySelector("[role=combobox]")?.getAttribute("aria-label"),
			rowItems: [...(row?.children ?? [])].map((child) => child.textContent),
		}).toStrictEqual({
			barClass: "@container pt-1",
			afterCard: true,
			rowClass:
				"flex min-h-6 items-center gap-x-1 gap-y-1.5 @max-[28.75rem]:flex-wrap px-2.5 text-[13px]/[20px] text-secondary [--cds-h-control:1.5rem]",
			placeClass: "flex min-w-0 items-center @max-[28.75rem]:basis-full",
			placeButton: "Folder: it's",
			rowItems: ["it's", "Plan", "Opus 4.8 Medium"],
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
			// Upstream paints the art 49x33 inside the 80px hit box, 9px in from its (mirrored) right edge and 13px up.
			art: {
				width: mascot.querySelector("svg")?.getAttribute("width"),
				height: mascot.querySelector("svg")?.getAttribute("height"),
				className: mascot.querySelector("svg")?.getAttribute("class"),
			},
			box: mascot.className,
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
			art: {width: "49", height: "33", className: "absolute top-[34px] left-[22px]"},
			box: "clawd-mascot pointer-events-none absolute right-[-13px] bottom-[calc(var(--cds-ring-outer,0px)-144px/11)] h-[80px] w-[80px] -scale-x-100 cursor-default border-0 bg-transparent p-0 outline-none [&_path]:pointer-events-auto",
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

	it("hides Send until the prompt has text", async () => {
		await renderApp();
		const send = () => screen.queryByRole<HTMLButtonElement>("button", {name: "Send"})?.disabled ?? null;
		await screen.findByRole("textbox", {name: "Prompt"});
		const before = send();

		await typePrompt("   ");
		const whitespace = send();

		await typePrompt("fix the flaky test");
		expect({before, whitespace, after: send()}).toStrictEqual({before: null, whitespace: null, after: false});
	});

	it("posts the prompt and the selected project to the herdr launch API", async () => {
		await renderApp();
		await typePrompt("fix the flaky test");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
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
			label: "Model: Opus 5.5 Medium",
			text: "Opus 5.5 Medium",
		});
	});

	it("passes the chin's mode, model and effort choices as launch flags", async () => {
		await renderApp();
		await typePrompt("fix the flaky test");

		fireEvent.click(screen.getByRole("button", {name: "Model: Opus 4.8 Medium"}));
		fireEvent.keyDown(await screen.findByRole("menu"), {key: "3", code: "Digit3"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		fireEvent.click(screen.getByRole("button", {name: /^Permissions: /}));
		fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", {name: /^Accept edits/}));
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(launchBody(launchCalls[0])).toStrictEqual({
			cwd: "/users/dev/it's",
			prompt: "fix the flaky test",
			args: ["--permission-mode", "acceptEdits", "--model", "sonnet"],
		});
	});

	it("launches in the project chosen from the picker", async () => {
		await renderApp();
		fireEvent.click(screen.getByRole("combobox", {name: /^Folder: /}));
		fireEvent.click(await screen.findByRole("option", {name: "newest"}));
		await waitFor(() => {
			expect(screen.getByRole("combobox", {name: /^Folder: /}).textContent).toBe("newest");
		});
		await typePrompt("hello");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(launchBody(launchCalls[0])).toStrictEqual({cwd: "/users/dev/newest", prompt: "hello"});
	});

	it("opens a searchable repository picker from the project chip", async () => {
		await renderApp();
		const chip = screen.getByRole("combobox", {name: /^Folder: /});
		expect({
			haspopup: chip.getAttribute("aria-haspopup"),
			expanded: chip.getAttribute("aria-expanded"),
		}).toStrictEqual({haspopup: "dialog", expanded: "false"});

		fireEvent.click(chip);
		const search = await screen.findByRole("textbox", {name: "Search projects"});
		await waitFor(() => {
			expect(document.activeElement).toBe(search);
		});
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

		await waitFor(() => {
			expect(screen.queryByRole("listbox")).toBeNull();
		});
		expect(chip.textContent).toBe("newest");
	});

	it("navigates to the new session when its SessionStart arrives over SSE", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null}));
		const {router, eventSource} = await renderApp();
		await typePrompt("fix the flaky test");
		fireEvent.click(screen.getByRole("button", {name: "Send"}));
		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});

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

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/session/new-session");
		});
	});

	it("navigates to the new session after a plain Enter send", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null}));
		const {router, eventSource} = await renderApp();
		const textarea = await typePrompt("fix the flaky test");

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter"});
		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {sessionId: "new-session", cwd: "/users/dev/it's", model: ""});
		});

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/session/new-session");
		});
	});

	it("sends with ⌘⏎ and stays home with a cleared prompt and a success toast", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: "stay-session"}));
		const {router, eventSource} = await renderApp();
		const textarea = await typePrompt("fix the flaky test");

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true});

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(launchBody(launchCalls[0])).toStrictEqual({cwd: "/users/dev/it's", prompt: "fix the flaky test"});
		expect((await findToast()).textContent).toContain("Started a session in it's");
		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {sessionId: "stay-session", cwd: "/users/dev/it's", model: ""});
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
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
		launchResponse = async () =>
			Promise.resolve(Response.json({error: "herdr writes are disabled"}, {status: 403}));
		await renderApp();
		await typePrompt("don't break $HOME");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(writeText.mock.calls).toStrictEqual([
				[`cd '/users/dev/it'\\''s' && claude 'don'\\''t break $HOME'`],
			]);
		});
		expect((await findToast()).textContent).toContain("Copied command — no terminal to launch in");
	});

	it("focuses the composer on ⇧⌘O while already home", async () => {
		await renderApp();
		const textarea = await screen.findByRole("textbox", {name: "Prompt"});
		const picker = screen.getByRole("combobox", {name: /^Folder: /});
		picker.focus();
		expect(document.activeElement).toBe(picker);

		fireEvent.keyDown(picker, {key: "O", code: "KeyO", metaKey: true, shiftKey: true});

		await waitFor(() => {
			expect(document.activeElement).toBe(textarea);
		});
	});

	it("replaces the home draft with a prefill request, focuses it and puts the caret at the end", async () => {
		await renderApp();
		const textarea = await typePrompt("hello");
		const picker = screen.getByRole("combobox", {name: /^Folder: /});
		picker.focus();
		const prefill =
			"Continue the work in progress on feat/x: look at the uncommitted changes, tell me what state they’re in, and finish what’s started.";

		act(() => {
			requestHomeComposerPrefill(prefill);
		});

		await waitFor(() => {
			expect(document.activeElement).toBe(textarea);
		});
		const field = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		expect({
			value: field.value,
			selectionStart: field.selectionStart,
			selectionEnd: field.selectionEnd,
		}).toStrictEqual({value: prefill, selectionStart: prefill.length, selectionEnd: prefill.length});
	});

	it("navigates home and focuses the composer on ⇧⌘O from another page", async () => {
		const {router} = await renderApp("/elsewhere");
		const elsewhere = await screen.findByRole("button", {name: "Elsewhere"});

		fireEvent.keyDown(elsewhere, {key: "O", code: "KeyO", metaKey: true, shiftKey: true});

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/");
		});
		const textarea = await screen.findByRole("textbox", {name: "Prompt"});
		await waitFor(() => {
			expect(document.activeElement).toBe(textarea);
		});
	});
});

describe("getComposerDefaults", () => {
	it("reads model, effort and default mode from settings.json", async () => {
		expect(
			await getComposerDefaults(async () =>
				Promise.resolve({
					model: "opus",
					effortLevel: "xhigh",
					permissions: {defaultMode: "acceptEdits"},
				}),
			),
		).toStrictEqual({
			model: "opus",
			effortLevel: "xhigh",
			defaultMode: "acceptEdits",
			bypassPermissionsAllowed: false,
		});
	});

	it("returns nulls when settings.json is missing", async () => {
		expect(await getComposerDefaults(async () => Promise.reject(new Error("ENOENT")))).toStrictEqual({
			model: null,
			effortLevel: null,
			defaultMode: null,
			bypassPermissionsAllowed: false,
		});
	});
});
