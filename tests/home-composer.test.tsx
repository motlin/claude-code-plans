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
import {HOME_RECENT_LIMIT} from "../src/components/home/home-composer";
import {NewSessionShortcut} from "../src/components/new-session-shortcut";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {composerDefaultsQueryOptions} from "../src/lib/api/composer-defaults";
import {usageQueryOptions} from "../src/lib/api/usage";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {getComposerDefaults} from "../src/lib/composer-state-server";
import type {ComposerDefaults} from "../src/lib/composer-state";
import {FOLDER_PERMISSION_MODE_STORAGE_KEY} from "../src/lib/folder-permission-mode";
import {requestHomeComposerPrefill} from "../src/lib/home-composer-focus";
import {HomeDock} from "../src/components/home/home-dock";
import {Route as HomeRoute, validateHomeSearch} from "../src/routes/index";
import {SSE_EVENTS} from "../src/lib/hook-events";
import {HOME_WORKTREE_STORAGE_KEY} from "../src/lib/home-worktree-pref";
import {attachContext, getContextChips, removeContextChip} from "../src/lib/context-attach";
import {createGroup, deleteGroup, readSessionGroupState, setPendingLaunchGroup} from "../src/lib/session-group-store";
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

const GIT_STATUS = {exists: true, isGitRepo: true, headBranch: "main", defaultBranch: "main", uncommittedFiles: 0};

const RECENTS = [recentSession("sess-1", "-users-dev-it-s", "it's")];

interface LaunchCall {
	url: string;
	init: RequestInit | undefined;
}

let launchCalls: LaunchCall[] = [];
let launchResponse: () => Promise<Response> = async () => new Promise<Response>(() => {});
let folderStatusCalls: string[] = [];
let folderStatusResponse: (() => Response) | null = null;

async function fetchMock(url: string, init?: RequestInit): Promise<Response> {
	if (url.startsWith("/api/home/folder-status?")) {
		folderStatusCalls.push(url);
		if (folderStatusResponse !== null) return folderStatusResponse();
	}
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
	fastMode = false,
	defaultsOverride: Partial<ComposerDefaults> = {},
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
		repoDefaultMode: null,
		bypassPermissionsAllowed: false,
		fastMode,
		fastModeBlocked: null,
		...defaultsOverride,
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
		...(HomeRoute.options.validateSearch ? {validateSearch: HomeRoute.options.validateSearch} : {}),
		component: HomeDock,
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

/** The toast deck's Notifications region. */
async function findToast(): Promise<HTMLElement> {
	return screen.findByRole("region", {name: "Notifications"});
}

describe("HomeComposer", () => {
	const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => Promise.resolve());

	beforeEach(() => {
		launchCalls = [];
		folderStatusCalls = [];
		folderStatusResponse = null;
		launchResponse = async () => new Promise<Response>(() => {});
		TestEventSource.current = null;
		setPendingLaunchGroup(null);
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
			placeholder: textarea.getAttribute("aria-placeholder"),
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
			rowItems: [
				place?.textContent,
				...[...(row?.lastElementChild?.children ?? [])].map((child) => child.textContent),
			],
		}).toStrictEqual({
			barClass: "@container flex w-full min-w-0 flex-col pt-0.5 -mb-0.5 md:pt-0 md:mb-0",
			afterCard: true,
			rowClass:
				"flex min-h-6 items-center gap-x-1 gap-y-1.5 @max-[28.75rem]:flex-wrap px-2.5 text-[13px]/[20px] text-secondary [--cds-h-control:1.5rem] [--cds-pad-md:0.375rem] comfortable:[&_button]:rounded-r6",
			placeClass: "flex items-center gap-1 @max-[28.75rem]:basis-full",
			placeButton: "Folder: it's",
			rowItems: ["it's", "Opus 4.8 Medium", "Plan", ""],
		});
	});

	it("leaves the Clawd mascot off the home composer; it peeks over the start card instead", async () => {
		await renderApp();
		await screen.findByRole("textbox", {name: "Prompt"});

		expect(document.querySelector("[data-home-composer] [data-clawd-mascot]")).toBeNull();
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
		expect({before, whitespace, after: send()}).toStrictEqual({
			before: null,
			whitespace: null,
			after: false,
		});
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

	it("shows the Fast word and a checked Fast mode row when settings start new sessions fast", async () => {
		await renderApp("/", null, () => {}, true);

		const trigger = await screen.findByRole("button", {name: /^Model:/});
		expect({label: trigger.getAttribute("aria-label"), text: trigger.textContent}).toStrictEqual({
			label: "Model: Opus 5.5 Fast Medium",
			text: "Opus 5.5 Fast Medium",
		});
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "I",
			code: "KeyI",
			metaKey: true,
			shiftKey: true,
		});
		const menu = await screen.findByRole("menu");
		expect(
			within(menu).getByRole("menuitemcheckbox", {name: "Enable fast mode"}).getAttribute("aria-checked"),
		).toBe("true");
	});

	it("omits the Fast word when settings leave new sessions at standard speed", async () => {
		await renderApp("/", null, () => {}, false);

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

	it("passes --worktree when the persisted Worktree preference is on", async () => {
		localStorage.setItem(HOME_WORKTREE_STORAGE_KEY, "true");
		await renderApp();
		await typePrompt("hello");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(launchBody(launchCalls[0])).toStrictEqual({
			cwd: "/users/dev/it's",
			prompt: "hello",
			args: ["--worktree"],
		});
	});

	it("reads Creating worktree… while a --worktree launch is pending", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null}));
		localStorage.setItem(HOME_WORKTREE_STORAGE_KEY, "true");
		await renderApp();
		await typePrompt("hello");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		expect((await screen.findByText(/^(Creating worktree|Starting session in)/)).textContent).toBe(
			"Creating worktree…",
		);
	});

	it("reads Starting session in {cwd}… while a launch without a worktree is pending", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null}));
		await renderApp();
		await typePrompt("hello");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		expect((await screen.findByText(/^(Creating worktree|Starting session in)/)).textContent).toBe(
			"Starting session in /users/dev/it's…",
		);
	});

	it("turns Worktree on from the environment bar's chip and launches with --worktree", async () => {
		folderStatusResponse = () => Response.json(GIT_STATUS);
		await renderApp();
		const toggle = await screen.findByTestId("environment-bar-worktree-toggle");
		const slot = toggle.closest("[data-testid=environment-bar-place] ~ div");
		fireEvent.click(toggle, {detail: 1});
		expect({
			inSlotAfterPlace: slot?.contains(toggle) ?? false,
			checked: toggle.getAttribute("aria-checked"),
			stored: localStorage.getItem(HOME_WORKTREE_STORAGE_KEY),
			focused: document.activeElement === screen.getByRole("textbox", {name: "Prompt"}),
		}).toStrictEqual({inSlotAfterPlace: true, checked: "true", stored: "true", focused: true});
		await typePrompt("hello");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect({
			launch: launchBody(launchCalls[0]),
			chipWhileLaunching: screen.queryByTestId("environment-bar-worktree-toggle"),
		}).toStrictEqual({
			launch: {cwd: "/users/dev/it's", prompt: "hello", args: ["--worktree"]},
			chipWhileLaunching: null,
		});
	});

	it("fetches the selected folder's git status and leaves the Worktree chip out for a non-git folder", async () => {
		folderStatusResponse = () => Response.json({...GIT_STATUS, isGitRepo: false, headBranch: null});
		localStorage.setItem(HOME_WORKTREE_STORAGE_KEY, "true");
		await renderApp();
		await waitFor(() => {
			expect(folderStatusCalls.length).toBe(1);
		});
		await typePrompt("hello");
		const chip = screen.queryByTestId("environment-bar-worktree-toggle");

		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect({folderStatusCalls, chip, launch: launchBody(launchCalls[0])}).toStrictEqual({
			folderStatusCalls: ["/api/home/folder-status?path=%2Fusers%2Fdev%2Fit%27s"],
			chip: null,
			launch: {cwd: "/users/dev/it's", prompt: "hello"},
		});
	});

	it("keeps the Worktree chip's visibility while a newly picked folder's git status loads", async () => {
		let answer: ((response: Response) => void) | null = null;
		folderStatusResponse = () => Response.json(GIT_STATUS);
		await renderApp();
		await screen.findByTestId("environment-bar-worktree-toggle");
		folderStatusResponse = null;
		const pending = new Promise<Response>((resolve) => {
			answer = resolve;
		});
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
			url.startsWith("/api/home/folder-status?") ? pending : fetchMock(url, init),
		);
		fireEvent.click(screen.getByRole("combobox", {name: /^Folder: /}));
		fireEvent.click(await screen.findByRole("option", {name: "newest"}));
		await waitFor(() => {
			expect(screen.getByRole("combobox", {name: /^Folder: /}).textContent).toBe("newest");
		});
		const whileLoading = screen.queryByTestId("environment-bar-worktree-toggle") !== null;
		await act(async () => {
			answer?.(Response.json({...GIT_STATUS, isGitRepo: false, headBranch: null}));
			await pending;
		});

		await waitFor(() => {
			expect(screen.queryByTestId("environment-bar-worktree-toggle")).toBeNull();
		});
		expect(whileLoading).toBe(true);
	});

	describe("environment bar line", () => {
		const lineHost = () => document.querySelector("[data-environment-bar-line-host]");
		const line = () => screen.queryByTestId("environment-bar-line");

		it("puts the zero-height line host between the pace-banner slot and the composer card", async () => {
			await renderApp();
			await screen.findByRole("textbox", {name: "Prompt"});
			const host = lineHost();

			expect({
				className: host?.className,
				previous: host?.previousElementSibling?.className,
				nextIsComposer: host?.nextElementSibling?.querySelector("[data-composer-card]") !== null,
				line: line(),
			}).toStrictEqual({
				className: "relative h-0",
				previous: "pb-1.5 empty:hidden",
				nextIsComposer: true,
				line: null,
			});
		});

		it("notes the custom group a new session will join, and Don’t add drops it", async () => {
			await renderApp();
			act(() => {
				setPendingLaunchGroup(createGroup("Infra").id);
			});
			const shown = await screen.findByTestId("environment-bar-line");
			const note = {color: shown.className.split(" ").at(-1), text: shown.textContent};
			fireEvent.click(screen.getByRole("button", {name: "Don’t add to Infra"}));

			expect({note, after: line()}).toStrictEqual({
				note: {
					color: "text-muted-as-secondary",
					text: "This session will be added to Infra in the sidebar when you start it.Don’t add",
				},
				after: null,
			});
		});

		it("drops the note when its group is deleted", async () => {
			await renderApp();
			const infra = createGroup("Infra");
			act(() => {
				setPendingLaunchGroup(infra.id);
			});
			await screen.findByTestId("environment-bar-line");
			act(() => {
				deleteGroup(infra.id);
			});

			expect(line()).toBeNull();
		});

		it("hides the host while a launch is starting and brings the note back when it fails", async () => {
			let fail: ((response: Response) => void) | null = null;
			launchResponse = async () =>
				new Promise<Response>((resolve) => {
					fail = resolve;
				});
			await renderApp();
			act(() => {
				setPendingLaunchGroup(createGroup("Infra").id);
			});
			await screen.findByTestId("environment-bar-line");
			await typePrompt("hello");
			fireEvent.click(screen.getByRole("button", {name: "Send"}));
			await waitFor(() => {
				expect(launchCalls.length).toBe(1);
			});
			const whileStarting = {host: lineHost(), line: line()};
			await act(async () => {
				fail?.(Response.json({error: "herdr agent.start timed out", code: "timeout"}, {status: 502}));
				await Promise.resolve();
			});

			await waitFor(() => {
				expect(line()?.textContent).toContain("Infra");
			});
			expect(whileStarting).toStrictEqual({host: null, line: null});
		});

		it("blocks a folder that no longer exists: a danger line, and a refused send with the same reason", async () => {
			folderStatusResponse = () =>
				Response.json({
					exists: false,
					isGitRepo: false,
					headBranch: null,
					defaultBranch: null,
					uncommittedFiles: 0,
				});
			await renderApp();
			act(() => {
				setPendingLaunchGroup(createGroup("Infra").id);
			});
			await waitFor(() => {
				expect(line()?.classList.contains("text-danger")).toBe(true);
			});
			const shown = screen.getByTestId("environment-bar-line");
			const bdis = Array.from(shown.querySelectorAll("bdi"), (bdi) => ({
				text: bdi.textContent,
				dir: bdi.getAttribute("dir"),
			}));
			const textarea = await typePrompt("hello");
			fireEvent.click(screen.getByRole("button", {name: "Send"}));
			const toast = await findToast();
			const block = document.querySelector("[data-home-composer] > p");

			expect({
				color: shown.className.split(" ").at(-1),
				text: shown.textContent,
				bdis,
				launches: launchCalls.length,
				toast: (await within(toast).findByText(/can’t start/)).textContent,
				value: (textarea as HTMLTextAreaElement).value,
				block: {className: block?.className, text: block?.textContent},
			}).toStrictEqual({
				color: "text-danger",
				text: "it's can’t start: /users/dev/it's no longer exists.",
				bdis: [
					{text: "it's", dir: null},
					{text: "/users/dev/it's", dir: "ltr"},
				],
				launches: 0,
				toast: "it's can’t start: /users/dev/it's no longer exists.",
				value: "hello",
				block: {
					className: "text-center text-balance text-footnote text-secondary",
					text: "This session will be added to Infra in the sidebar when you start it. Don’t add",
				},
			});
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

	it("adds the launched session to the custom group whose + started it", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: null}));
		const {router, eventSource} = await renderApp();
		const work = createGroup("Work");
		setPendingLaunchGroup(work.id);
		await typePrompt("fix the flaky test");
		fireEvent.click(screen.getByRole("button", {name: "Send"}));
		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
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
		expect(readSessionGroupState().assignments).toStrictEqual({"new-session": work.id});
	});

	it("adds a session sent with ⌘⏎ to the pending custom group by herdr's id", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: "stay-session"}));
		await renderApp();
		const work = createGroup("Work");
		setPendingLaunchGroup(work.id);
		const textarea = await typePrompt("fix the flaky test");

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true});

		await waitFor(() => {
			expect(readSessionGroupState().assignments).toStrictEqual({"stay-session": work.id});
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

	it("sends with ⌘⏎ and stays home with a cleared prompt and a success toast", async () => {
		launchResponse = async () =>
			Promise.resolve(Response.json({ok: true, tabId: "t1", paneId: "p1", sessionId: "stay-session"}));
		const {router, eventSource} = await renderApp();
		const textarea = await typePrompt("fix the flaky test");

		fireEvent.keyDown(textarea, {key: "Enter", code: "Enter", metaKey: true});

		await waitFor(() => {
			expect(launchCalls.length).toBe(1);
		});
		expect(launchBody(launchCalls[0])).toStrictEqual({
			cwd: "/users/dev/it's",
			prompt: "fix the flaky test",
		});
		expect((await findToast()).textContent).toContain("Started a session in it's");
		act(() => {
			eventSource.emit(SSE_EVENTS.SESSION_START, {
				sessionId: "stay-session",
				cwd: "/users/dev/it's",
				model: "",
			});
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
		});
		expect({
			path: router.state.location.pathname,
			prompt: (textarea as HTMLTextAreaElement).value,
		}).toStrictEqual({
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

	describe("a failed launch", () => {
		const failedLaunch = async () =>
			Promise.resolve(Response.json({error: "herdr agent.start timed out", code: "timeout"}, {status: 502}));
		const card = () => document.querySelector("[data-home-composer] [data-testid=send-rejected-card]");
		const textarea = () => screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});

		afterEach(() => {
			for (const chip of getContextChips("home")) removeContextChip("home", chip.id);
		});

		async function sendAndFail(prompt = "fix the flaky test") {
			launchResponse = failedLaunch;
			await renderApp();
			await typePrompt(prompt);
			fireEvent.click(screen.getByRole("button", {name: "Send"}));
			await waitFor(() => {
				expect(card()).not.toBeNull();
			});
		}

		it("puts the prompt back and shows the start-failed card above the composer without a toast or clipboard write", async () => {
			await sendAndFail();

			const shown = card();
			expect({
				value: textarea().value,
				startFailed: shown?.hasAttribute("data-start-failed"),
				alert: shown?.querySelector("[role=alert]")?.textContent,
				message: shown?.querySelector("[data-send-rejected-message]")?.textContent,
				nextHoldsComposer:
					shown?.parentElement?.nextElementSibling?.nextElementSibling?.querySelector(
						"[data-composer-card]",
					) !== null,
				toast: document.querySelectorAll("[data-toast]").length,
				clipboard: writeText.mock.calls,
			}).toStrictEqual({
				value: "fix the flaky test",
				startFailed: true,
				alert: "Something went wrong Try sending your message again. If it keeps failing, the error details show why.",
				message: "herdr agent.start timed out",
				nextHoldsComposer: true,
				toast: 0,
				clipboard: [],
			});
		});

		it("relaunches the unchanged prompt from Try again, clearing the card while the launch is pending", async () => {
			await sendAndFail();
			launchResponse = async () => new Promise<Response>(() => {});

			fireEvent.click(screen.getByRole("button", {name: "Try again"}));

			await waitFor(() => {
				expect(launchCalls.length).toBe(2);
			});
			expect({card: card(), bodies: launchCalls.map(launchBody)}).toStrictEqual({
				card: null,
				bodies: [
					{cwd: "/users/dev/it's", prompt: "fix the flaky test"},
					{cwd: "/users/dev/it's", prompt: "fix the flaky test"},
				],
			});
		});

		it("focuses the edited prompt from Try again without relaunching", async () => {
			await sendAndFail();
			fireEvent.change(textarea(), {target: {value: "fix the flaky test now"}});

			fireEvent.click(screen.getByRole("button", {name: "Try again"}));

			expect({
				launches: launchCalls.length,
				focused: document.activeElement === textarea(),
				value: textarea().value,
				card: card(),
			}).toStrictEqual({launches: 1, focused: true, value: "fix the flaky test now", card: null});
		});

		it("keeps the prompt when the card is dismissed", async () => {
			await sendAndFail();

			fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));

			expect({card: card(), value: textarea().value}).toStrictEqual({card: null, value: "fix the flaky test"});
		});

		it("still copies the command when herdr itself can't be reached", async () => {
			launchResponse = async () =>
				Promise.resolve(Response.json({error: "connect ENOENT", code: "connect-failed"}, {status: 502}));
			await renderApp();
			await typePrompt("hello");

			fireEvent.click(screen.getByRole("button", {name: "Send"}));

			expect((await findToast()).textContent).toContain("Copied command — no terminal to launch in");
			expect({card: card(), clipboard: writeText.mock.calls}).toStrictEqual({
				card: null,
				clipboard: [[`cd '/users/dev/it'\\''s' && claude 'hello'`]],
			});
		});

		it("restores the prompt's context tile and relaunches with it", async () => {
			launchResponse = failedLaunch;
			await renderApp();
			await typePrompt("explain this");
			act(() => {
				attachContext("home", {kind: "excerpt", text: "Hermit crabs"});
			});
			fireEvent.click(screen.getByRole("button", {name: "Send"}));
			await waitFor(() => {
				expect(card()).not.toBeNull();
			});
			const firstPrompt = (launchBody(launchCalls[0]) as {prompt: string}).prompt;
			const restored = getContextChips("home").map((chip) => chip.kind);
			const value = textarea().value;
			launchResponse = async () => new Promise<Response>(() => {});

			fireEvent.click(screen.getByRole("button", {name: "Try again"}));

			await waitFor(() => {
				expect(launchCalls.length).toBe(2);
			});
			expect({
				restored,
				value,
				carriedExcerpt: firstPrompt.includes("Hermit crabs"),
				resent: (launchBody(launchCalls[1]) as {prompt: string}).prompt,
			}).toStrictEqual({restored: ["excerpt"], value: "explain this", carriedExcerpt: true, resent: firstPrompt});
		});

		it("puts the prompt back in the stored draft with a toast when home was left before the launch failed", async () => {
			let fail: () => void = () => {};
			launchResponse = async () =>
				new Promise<Response>((resolve) => {
					fail = () => {
						resolve(Response.json({error: "herdr agent.start timed out", code: "timeout"}, {status: 502}));
					};
				});
			const {router} = await renderApp();
			await typePrompt("fix the flaky test");
			fireEvent.click(screen.getByRole("button", {name: "Send"}));
			await waitFor(() => {
				expect(launchCalls.length).toBe(1);
			});
			act(() => {
				router.history.push("/elsewhere");
			});
			await screen.findByRole("button", {name: "Elsewhere"});

			act(() => {
				fail();
			});

			await waitFor(() => {
				expect(
					document.querySelector("[data-focus-region=notifications] [data-toast-message]")?.textContent,
				).toBe("Your new session couldn’t start. Your prompt is back on the New session page.");
			});
			const stored: unknown = JSON.parse(localStorage.getItem("ccp-composer-draft:home") ?? "null");
			await act(async () => router.navigate({to: "/"}));
			await waitFor(() => {
				expect(textarea().value).toBe("fix the flaky test");
			});
			expect({stored, card: card()}).toStrictEqual({stored: {text: "fix the flaky test"}, card: null});
		});

		it("shows the card without copying the command when claude started but the prompt didn't arrive", async () => {
			launchResponse = async () =>
				Promise.resolve(
					Response.json(
						{error: "Fabricated pane gone", code: "agent_prompt_failed", sessionId: "s-started"},
						{status: 502},
					),
				);
			await renderApp();
			await typePrompt("hello");

			fireEvent.click(screen.getByRole("button", {name: "Send"}));

			await waitFor(() => {
				expect(card()).not.toBeNull();
			});
			expect({
				message: card()?.querySelector("[data-send-rejected-message]")?.textContent,
				value: textarea().value,
				clipboard: writeText.mock.calls,
			}).toStrictEqual({message: "Fabricated pane gone", value: "hello", clipboard: []});
		});
	});

	describe("per-folder remembered permission mode", () => {
		const HERE = "/users/dev/it's";
		const OTHER = "/users/dev/newest";

		function rememberModes(modes: Record<string, string>) {
			localStorage.setItem(FOLDER_PERMISSION_MODE_STORAGE_KEY, JSON.stringify(modes));
		}

		function storedModes(): unknown {
			const raw = localStorage.getItem(FOLDER_PERMISSION_MODE_STORAGE_KEY);
			return raw === null ? null : JSON.parse(raw);
		}

		function modeReadout(): string | null | undefined {
			return document.querySelector("[data-chin-mode]")?.textContent;
		}

		async function pickMode(name: RegExp) {
			fireEvent.click(screen.getByRole("button", {name: /^Permissions: /}));
			fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitemradio", {name}));
			await waitFor(() => {
				expect(screen.queryByRole("menu")).toBeNull();
			});
		}

		async function chooseFolder(name: string) {
			fireEvent.click(screen.getByRole("combobox", {name: /^Folder: /}));
			fireEvent.click(await screen.findByRole("option", {name}));
			await waitFor(() => {
				expect(screen.getByRole("combobox", {name: /^Folder: /}).textContent).toBe(name);
			});
		}

		function consentToAuto() {
			vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
				url === "/api/permission-mode-consent"
					? Response.json({autoModeIsDefault: false, autoConsented: true, acks: []})
					: fetchMock(url, init),
			);
		}

		it("starts the draft in the folder's remembered mode and launches with it", async () => {
			rememberModes({[HERE]: "acceptEdits"});
			await renderApp("/", "claude-opus-4-8[1m]", () => {}, false, {defaultMode: null});
			await waitFor(() => {
				expect(modeReadout()).toBe("Accept edits");
			});
			await typePrompt("hello");

			fireEvent.click(screen.getByRole("button", {name: "Send"}));

			await waitFor(() => {
				expect(launchCalls.length).toBe(1);
			});
			expect(launchBody(launchCalls[0])).toStrictEqual({
				cwd: HERE,
				prompt: "hello",
				args: ["--permission-mode", "acceptEdits"],
			});
		});

		it("lets the user-scope default beat the folder memory and launches without a flag", async () => {
			rememberModes({[HERE]: "acceptEdits"});
			await renderApp("/", "claude-opus-4-8[1m]", () => {}, false, {defaultMode: "auto"});
			await typePrompt("hello");
			const readout = modeReadout();

			fireEvent.click(screen.getByRole("button", {name: "Send"}));

			await waitFor(() => {
				expect(launchCalls.length).toBe(1);
			});
			expect({readout, body: launchBody(launchCalls[0])}).toStrictEqual({
				readout: "Auto",
				body: {cwd: HERE, prompt: "hello"},
			});
		});

		it("remembers a Manual pick for the folder but never a Plan pick", async () => {
			await renderApp("/", "claude-opus-4-8[1m]", () => {}, false, {defaultMode: null});
			await pickMode(/^Plan/);
			const afterPlan = storedModes();
			await pickMode(/^Manual/);

			expect({afterPlan, afterManual: storedModes()}).toStrictEqual({
				afterPlan: null,
				afterManual: {[HERE]: "default"},
			});
		});

		it("carries an Accept edits pick to another folder without writing it there", async () => {
			await renderApp("/", "claude-opus-4-8[1m]", () => {}, false, {defaultMode: null});
			await pickMode(/^Accept edits/);
			await chooseFolder("newest");

			expect({readout: modeReadout(), stored: storedModes()}).toStrictEqual({
				readout: "Accept edits",
				stored: {[HERE]: "acceptEdits"},
			});
		});

		it("drops an Auto pick on a folder switch so the new folder's memory shows", async () => {
			rememberModes({[OTHER]: "acceptEdits"});
			consentToAuto();
			await renderApp("/", "claude-opus-4-8[1m]", () => {}, false, {defaultMode: null});
			await pickMode(/^Auto/);
			await waitFor(() => {
				expect(modeReadout()).toBe("Auto");
			});
			const afterPick = modeReadout();
			await chooseFolder("newest");

			expect({afterPick, afterSwitch: modeReadout(), stored: storedModes()}).toStrictEqual({
				afterPick: "Auto",
				afterSwitch: "Accept edits",
				stored: {[OTHER]: "acceptEdits", [HERE]: "auto"},
			});
		});

		it("reads Manual for a remembered Bypass once bypass is no longer offered", async () => {
			rememberModes({[HERE]: "bypassPermissions"});
			await renderApp("/", "claude-opus-4-8[1m]", () => {}, false, {
				defaultMode: null,
				bypassPermissionsAllowed: false,
			});

			await waitFor(() => {
				expect(modeReadout()).toBe("Manual");
			});
		});
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

	it("prefills a Make something new template from ?create=, focuses it, drops the param and sends nothing", async () => {
		const {router} = await renderApp("/?create=slides");
		const field = await screen.findByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		const prefill = "Make a Slides artifact: ";

		await waitFor(() => {
			expect(router.state.location.searchStr).toBe("");
		});
		expect({
			value: field.value,
			focused: document.activeElement === field,
			caret: [field.selectionStart, field.selectionEnd],
			path: router.state.location.pathname,
			launches: launchCalls.length,
		}).toStrictEqual({
			value: prefill,
			focused: true,
			caret: [prefill.length, prefill.length],
			path: "/",
			launches: 0,
		});
	});

	it("names Docs for upstream's ?create=pages and ignores unknown templates", async () => {
		expect([
			validateHomeSearch({create: "pages"}),
			validateHomeSearch({create: "dashboard"}),
			validateHomeSearch({create: "bogus"}),
			validateHomeSearch({}),
		]).toStrictEqual([{create: "pages"}, {create: "dashboard"}, {}, {}]);

		await renderApp("/?create=pages");
		const field = await screen.findByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		await waitFor(() => {
			expect(field.value).toBe("Make a Docs artifact: ");
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
		}).toStrictEqual({
			value: prefill,
			selectionStart: prefill.length,
			selectionEnd: prefill.length,
		});
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
			repoDefaultMode: null,
			bypassPermissionsAllowed: false,
			fastMode: false,
			fastModeBlocked: null,
		});
	});

	it("starts new sessions fast when settings.json sets fastMode without a per-session opt-in", async () => {
		expect(
			await Promise.all([
				getComposerDefaults(async () => Promise.resolve({fastMode: true})),
				getComposerDefaults(async () => Promise.resolve({fastMode: true, fastModePerSessionOptIn: true})),
			]),
		).toStrictEqual([
			{
				model: null,
				effortLevel: null,
				defaultMode: null,
				repoDefaultMode: null,
				bypassPermissionsAllowed: false,
				fastMode: true,
				fastModeBlocked: null,
			},
			{
				model: null,
				effortLevel: null,
				defaultMode: null,
				repoDefaultMode: null,
				bypassPermissionsAllowed: false,
				fastMode: false,
				fastModeBlocked: null,
			},
		]);
	});

	it("blocks fast mode for new sessions when the env or a managed policy turns it off", async () => {
		expect(
			(
				await Promise.all([
					getComposerDefaults(async () => Promise.resolve({env: {CLAUDE_CODE_USE_BEDROCK: "1"}})),
					getComposerDefaults(async () => Promise.resolve({}), {
						readManagedSettings: async () => Promise.resolve({fastMode: false}),
					}),
				])
			).map((defaults) => defaults.fastModeBlocked),
		).toStrictEqual([
			{
				line: "Not available with this provider",
				reason: "Fast mode is only available when Claude Code uses the Claude API directly.",
			},
			{line: "Not available"},
		]);
	});

	it("returns nulls when settings.json is missing", async () => {
		expect(await getComposerDefaults(async () => Promise.reject(new Error("ENOENT")))).toStrictEqual({
			model: null,
			effortLevel: null,
			defaultMode: null,
			repoDefaultMode: null,
			bypassPermissionsAllowed: false,
			fastMode: false,
			fastModeBlocked: null,
		});
	});
});
