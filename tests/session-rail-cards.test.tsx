// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SessionRailCards, type SessionRailInputs} from "../src/components/session-rail/session-rail-cards";
import {ToastProvider} from "../src/components/toast";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import type {HerdrPaneIndexData} from "../src/lib/api/herdr";
import {sessionDiffQueryOptions} from "../src/lib/api/session-diff";
import {sessionDevServersQueryOptions, sessionOpenInQueryOptions} from "../src/lib/api/sessions";
import type {BackgroundTask} from "../src/lib/background-tasks";
import type {ContextBreakdown} from "../src/lib/context-breakdown";
import {DEFAULT_RAIL_SECTIONS_STATE, RAIL_SECTIONS_STORAGE_KEY} from "../src/lib/session-rail-store";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";

type HerdrPane = HerdrPaneIndexData["panes"][number];

const PANE: HerdrPane = {
	host: "herdr",
	paneId: "p1",
	terminalId: "t1",
	workspaceId: "w1",
	tabId: "tab1",
	focused: false,
	cwd: "/Users/alice/projects/avalonlogs",
	foregroundCwd: null,
	agentStatus: "working",
	agent: "claude",
	terminalTitle: "claude",
	agentSessionId: SESSION_ID,
	revision: 1,
	sessionId: SESSION_ID,
	via: "env",
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

const BASE: SessionRailInputs = {
	sessionId: SESSION_ID,
	homeRoot: "/Users/alice",
	cwd: "/Users/alice/projects/avalonlogs",
	gitBranch: "alice/sync-upstream",
	model: "Opus 4.7",
	herdrPane: null,
	live: true,
	working: false,
	usage: null,
	breakdown: null,
	artifacts: [],
	backgroundTasks: {running: [], finished: []},
	pr: null,
	prStatus: null,
};

const FULL: SessionRailInputs = {
	...BASE,
	usage: {
		contextTokens: 190_200,
		contextWindowSize: 1_000_000,
		contextPercent: 19,
		fiveHour: {usedPercentage: 42, resetsAt: Math.floor(Date.now() / 1000) + 3600},
		weekly: null,
		updatedAt: null,
	},
	artifacts: [
		{
			url: "https://claude.ai/artifact/abc",
			id: "abc",
			kind: "html",
			title: "Rail report",
			previewable: false,
			lastEventAt: 1,
		},
	],
	backgroundTasks: {
		running: [
			{
				id: "b1",
				toolUseId: "toolu_1",
				kind: "bash",
				description: "Run the dev server",
				command: "just dev",
				status: "running",
				output: null,
				summary: null,
				outputFile: null,
				startedAt: null,
			},
		],
		finished: [
			{
				id: "b2",
				toolUseId: "toolu_2",
				kind: "bash",
				description: "Build",
				command: "just build",
				status: "completed",
				output: null,
				summary: null,
				outputFile: null,
				startedAt: null,
			},
		],
	},
	pr: {number: 42, url: "https://github.com/alice/avalonlogs/pull/42", repository: "alice/avalonlogs"},
	prStatus: {number: 42, state: "open", title: "Sync fork with upstream"},
};

function seed(client: QueryClient) {
	client.setQueryData(customizeMcpServersQueryOptions.queryKey, [
		{
			id: "user:github",
			name: "github",
			scope: "user",
			transport: "http",
			urlOrCommand: "https://api.github.com/mcp",
			enabled: true,
			envKeys: [],
			headerKeys: [],
			needsAuth: false,
		},
		{
			id: "user:linear",
			name: "linear",
			scope: "user",
			transport: "http",
			urlOrCommand: "https://mcp.linear.app",
			enabled: true,
			envKeys: [],
			headerKeys: [],
			needsAuth: true,
		},
		{
			id: "user:off",
			name: "off",
			scope: "user",
			transport: "stdio",
			urlOrCommand: "off",
			enabled: false,
			envKeys: [],
			headerKeys: [],
			needsAuth: false,
		},
	]);
	client.setQueryData(sessionDevServersQueryOptions(SESSION_ID, true).queryKey, {
		servers: [{url: "http://localhost:7611", live: true}],
	});
	client.setQueryData(sessionDiffQueryOptions(SESSION_ID, "uncommitted").queryKey, {
		scope: "uncommitted",
		source: "git",
		stats: {files: 3, additions: 120, deletions: 8},
		files: [],
	});
}

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const unregisters: Array<() => void> = [];

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	// Seeded queries refetch on mount; leave those requests pending so the seeds stand.
	vi.stubGlobal("fetch", async () => new Promise<Response>(() => {}));
});

afterEach(() => {
	for (const unregister of unregisters.splice(0)) unregister();
	cleanup();
	vi.unstubAllGlobals();
});

async function renderCards(inputs: SessionRailInputs, prepare: (client: QueryClient) => void = () => {}) {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	prepare(client);
	const rootRoute = createRootRoute({
		component: () => (
			<TileHost sessionId={SESSION_ID}>
				<SessionRailCards inputs={inputs} />
			</TileHost>
		),
	});
	const router = createRouter({routeTree: rootRoute, history: createMemoryHistory({initialEntries: ["/"]})});
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<RouterProvider router={router} />
			</ToastProvider>
		</QueryClientProvider>,
	);
	await act(async () => {
		await router.load();
	});
}

/** Context starts collapsed upstream; a hand toggle in another session makes it start open. */
function openContextByDefault() {
	localStorage.setItem(
		RAIL_SECTIONS_STORAGE_KEY,
		JSON.stringify({state: {...DEFAULT_RAIL_SECTIONS_STATE, startsOpen: {context: true}}, version: 0}),
	);
}

function cards(): Array<[string, string | null]> {
	return [...document.querySelectorAll<HTMLElement>("[data-rail-section]")].map((section) => [
		section.dataset["railSection"] ?? "",
		section.querySelector("[data-rail-summary]")?.textContent ?? null,
	]);
}

function rows(section: string): Array<[string, string | null]> {
	const card = screen.getByRole("region", {name: new RegExp(`^${section}`)});
	return [...within(card).getByTestId("rail-rows").children].map((row) => [
		row.querySelector("[data-rail-row-label]")?.textContent ?? "",
		row.querySelector("[data-rail-row-hint]")?.textContent ?? null,
	]);
}

describe("Environment card", () => {
	function bridge(client: QueryClient) {
		client.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
			cwd: BASE.cwd,
			bridgeSessionId: "cse_bridge",
		});
	}

	function remoteControlLinks() {
		const card = screen.getByRole("region", {name: /^Environment/});
		return within(card)
			.queryAllByRole("link", {name: /Remote Control/})
			.map((link) => [
				link.textContent,
				link.getAttribute("href"),
				link.getAttribute("target"),
				link.getAttribute("title"),
			]);
	}

	it("labels a session no terminal host owns Local, with its branch, model and a missing herdr pane", async () => {
		await renderCards(BASE);

		expect({rows: rows("Environment"), remoteControl: remoteControlLinks()}).toStrictEqual({
			rows: [
				["~/projects/avalonlogs", "Local"],
				["alice/sync-upstream", null],
				["Opus 4.7", null],
				["herdr", "No pane"],
			],
			remoteControl: [],
		});
	});

	it("adds an offline Remote Control line linking to claude.ai under a bridged Local session", async () => {
		await renderCards({...BASE, gitBranch: null, model: null, live: false}, bridge);

		expect({rows: rows("Environment"), remoteControl: remoteControlLinks()}).toStrictEqual({
			rows: [
				["~/projects/avalonlogs", "Local"],
				["Remote Control · Offline", null],
				["herdr", "No pane"],
			],
			remoteControl: [
				["Remote Control · Offline", "https://claude.ai/code/session_bridge", "_blank", "Open in claude.ai"],
			],
		});
	});

	it("labels a herdr session herdr and links its live pane's agent status to its terminal", async () => {
		await renderCards({...BASE, gitBranch: null, model: null, herdrPane: PANE});
		const card = screen.getByRole("region", {name: /^Environment/});

		expect({
			rows: rows("Environment"),
			href: within(card).getByRole("link", {name: /herdr/}).getAttribute("href"),
			remoteControl: remoteControlLinks(),
		}).toStrictEqual({
			rows: [
				["~/projects/avalonlogs", "herdr"],
				["herdr", "working"],
			],
			href: `/terminals/${SESSION_ID}`,
			remoteControl: [],
		});
	});

	it("shows Remote Control as a connected secondary line under a bridged herdr session", async () => {
		await renderCards({...BASE, gitBranch: null, model: null, herdrPane: PANE}, bridge);

		expect({rows: rows("Environment"), remoteControl: remoteControlLinks()}).toStrictEqual({
			rows: [
				["~/projects/avalonlogs", "herdr"],
				["Remote Control · Connected", null],
				["herdr", "working"],
			],
			remoteControl: [
				["Remote Control · Connected", "https://claude.ai/code/session_bridge", "_blank", "Open in claude.ai"],
			],
		});
	});

	it("names a herdr named session beside herdr, bridged or not", async () => {
		const named = {...PANE, paneId: "wM:p1@later", workspaceId: "wM@later"};
		await renderCards({...BASE, gitBranch: null, model: null, herdrPane: named});
		const plain = rows("Environment");
		cleanup();
		await renderCards({...BASE, gitBranch: null, model: null, herdrPane: named}, bridge);

		expect({plain, bridged: rows("Environment")}).toStrictEqual({
			plain: [
				["~/projects/avalonlogs", "herdr · later"],
				["herdr", "working"],
			],
			bridged: [
				["~/projects/avalonlogs", "herdr · later"],
				["Remote Control · Connected", null],
				["herdr", "working"],
			],
		});
	});

	it("labels a tmux session by its tmux session and shows its pane id, without a terminal link", async () => {
		const tmux: SessionRailInputs = {
			...BASE,
			gitBranch: null,
			model: null,
			herdrPane: {
				...PANE,
				host: "tmux",
				paneId: "%7",
				workspaceId: "work",
				agentStatus: "unknown",
				via: "process",
			},
		};
		await renderCards(tmux);
		const card = screen.getByRole("region", {name: /^Environment/});
		const plain = {rows: rows("Environment"), links: within(card).queryAllByRole("link")};
		cleanup();
		await renderCards(tmux, bridge);

		expect({plain, bridged: rows("Environment")}).toStrictEqual({
			plain: {
				rows: [
					["~/projects/avalonlogs", "tmux · work"],
					["tmux", "%7"],
				],
				links: [],
			},
			bridged: [
				["~/projects/avalonlogs", "tmux · work"],
				["Remote Control · Connected", null],
				["tmux", "%7"],
			],
		});
	});
});

describe("cards from local data", () => {
	it("shows only Environment and Context's placeholder when the session has nothing else", async () => {
		openContextByDefault();
		await renderCards(BASE);

		expect({
			cards: cards(),
			context: screen.getByRole("region", {name: /^Context/}).querySelector("[data-rail-body]")?.textContent,
		}).toStrictEqual({
			cards: [
				["environment", "alice/sync-upstream"],
				["context", null],
			],
			context: "Send a message to see context usage.",
		});
	});

	it("renders every card with content in upstream's order, with its summary", async () => {
		await renderCards(FULL, seed);

		expect(cards()).toStrictEqual([
			["environment", "alice/sync-upstream"],
			["context", "19%"],
			["connectors", "1 to reconnect"],
			["outputs", null],
			["pullRequests", "1 pull request"],
			["servers", null],
			["backgroundTasks", "1 running"],
		]);
	});

	it("lists each card's rows once expanded", async () => {
		await renderCards(FULL, seed);
		fireEvent.click(screen.getByRole("button", {name: /^Connectors/}), {altKey: true});

		expect({
			connectors: rows("Connectors"),
			progress: screen.queryByRole("region", {name: /^Progress/}),
			outputs: rows("Outputs"),
			changes: rows("Changes"),
			servers: rows("Servers"),
			backgroundTasks: rows("Background tasks"),
			context: screen.getByRole("progressbar", {name: "Context window"}).getAttribute("aria-valuenow"),
			usage: screen.queryByRole("progressbar", {name: "Session limit"}),
		}).toStrictEqual({
			connectors: [
				["github", null],
				["linear", "Reconnect"],
			],
			progress: null,
			outputs: [["Rail report", null]],
			changes: [
				["#42 Sync fork with upstream", "Open"],
				["Uncommitted changes", "+120 −8"],
			],
			servers: [["localhost:7611", "Running"]],
			backgroundTasks: [
				["Run the dev server", null],
				["1 finished", null],
			],
			context: "19",
			usage: null,
		});
	});

	it("opens a background task in the Background tasks pane, which swaps the rail out", async () => {
		unregisters.push(
			registerPane("background-tasks", {title: "Background tasks", render: () => <p>tasks pane body</p>}),
		);
		await renderCards(FULL, seed);
		fireEvent.click(screen.getByRole("button", {name: "Open Run the dev server in Background tasks"}));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		expect(
			screen
				.getAllByRole("region", {name: "Background tasks"})
				.flatMap((region) => within(region).queryAllByText("tasks pane body"))
				.map((body) => body.tagName),
		).toStrictEqual(["P"]);
	});
});

describe("Background tasks card", () => {
	function runningTask(index: number, startedAt: string | null = null): BackgroundTask {
		return {
			id: `b${index}`,
			toolUseId: `toolu_${index}`,
			kind: "bash",
			description: `Task ${index}`,
			command: null,
			status: "running",
			output: null,
			summary: null,
			outputFile: null,
			startedAt,
		};
	}

	function finishedTask(): BackgroundTask {
		return {...runningTask(99), description: "Done", status: "completed"};
	}

	function withTasks(running: BackgroundTask[], finished: BackgroundTask[] = []): SessionRailInputs {
		return {...BASE, backgroundTasks: {running, finished}};
	}

	const SIX = [1, 2, 3, 4, 5, 6].map((index) => runningTask(index));

	it("lists four running tasks, then a collapsed Show more", async () => {
		await renderCards(withTasks(SIX));

		expect({
			rows: rows("Background tasks"),
			expanded: screen.getByRole("button", {name: "Show more"}).getAttribute("aria-expanded"),
		}).toStrictEqual({
			rows: [
				["Task 1", null],
				["Task 2", null],
				["Task 3", null],
				["Task 4", null],
				["Show more", null],
			],
			expanded: "false",
		});
	});

	it("expands in place to every running task with Show less, and collapses back", async () => {
		await renderCards(withTasks(SIX));
		fireEvent.click(screen.getByRole("button", {name: "Show more"}));
		const expanded = {
			rows: rows("Background tasks"),
			expanded: screen.getByRole("button", {name: "Show less"}).getAttribute("aria-expanded"),
		};
		fireEvent.click(screen.getByRole("button", {name: "Show less"}));

		expect({expanded, collapsed: rows("Background tasks").length}).toStrictEqual({
			expanded: {
				rows: [
					["Task 1", null],
					["Task 2", null],
					["Task 3", null],
					["Task 4", null],
					["Task 5", null],
					["Task 6", null],
					["Show less", null],
				],
				expanded: "true",
			},
			collapsed: 5,
		});
	});

	it("focuses the first newly shown row when Show more is pressed from the keyboard", async () => {
		await renderCards(withTasks(SIX));
		const toggle = screen.getByRole("button", {name: "Show more"});
		toggle.focus();
		fireEvent.click(toggle, {detail: 0});

		expect(document.activeElement?.getAttribute("aria-label")).toBe("Open Task 5 in Background tasks");
	});

	it("labels each row as opening it in Background tasks", async () => {
		await renderCards(withTasks([runningTask(1)]));

		expect(
			within(screen.getByRole("region", {name: /^Background tasks/}))
				.getAllByRole("button", {name: /^Open /})
				.map((row) => row.getAttribute("aria-label")),
		).toStrictEqual(["Open Task 1 in Background tasks"]);
	});

	it("shows how long a running task has run", async () => {
		await renderCards(withTasks([runningTask(1, new Date(Date.now() - 2 * 3_600_000).toISOString())]));

		expect(rows("Background tasks")).toStrictEqual([["Task 1", "2h 0m"]]);
	});

	it("gives the finished row the agents icon", async () => {
		await renderCards(withTasks([runningTask(1)], [finishedTask()]));
		const finished = screen.getByRole("button", {name: "1 finished"});

		expect(finished.querySelector("svg")?.getAttribute("class")).toContain("lucide-bot");
	});

	it("leaves the rail when only finished tasks remain", async () => {
		await renderCards(withTasks([], [finishedTask()]));

		expect(document.querySelector('[data-rail-section="backgroundTasks"]')).toBe(null);
	});
});

describe("Context card", () => {
	beforeEach(openContextByDefault);

	const SIXTEEN_HOURS_AGO = () => new Date(Date.now() - 16 * 3_600_000).toISOString();

	function contextInputs(updatedAt: string | null, working = false): SessionRailInputs {
		return {
			...BASE,
			working,
			usage: {
				contextTokens: 178_500,
				contextWindowSize: 1_000_000,
				contextPercent: 18,
				fiveHour: null,
				weekly: null,
				updatedAt,
			},
		};
	}

	function contextBody() {
		const body = screen.getByRole("region", {name: /^Context/}).querySelector("[data-rail-body]");
		if (!body) throw new Error("no Context body");
		return body;
	}

	it("headlines the percent used over the token summary and a 4px meter, like upstream", async () => {
		await renderCards(contextInputs(null));

		const body = contextBody();
		const summary = body.querySelector("[data-rail-context-summary]");
		const bar = within(body as HTMLElement).getByRole("progressbar", {name: "Context window"});
		expect({
			text: body.textContent,
			summary: summary?.textContent,
			pct: summary?.getAttribute("data-rail-context-pct"),
			bar: bar.className,
			track: bar.style.backgroundColor,
			fill: bar.firstElementChild?.className,
		}).toStrictEqual({
			text: "18% used178.5k / 1M",
			summary: "178.5k / 1M",
			pct: "18",
			bar: "h-[4px] rounded-full overflow-hidden",
			track: "var(--chart-reference-tint)",
			fill: "h-full bg-accent-100 transition-[width]",
		});
	});

	it("says when usage was last updated and that a message refreshes it", async () => {
		await renderCards(contextInputs(SIXTEEN_HOURS_AGO()));

		expect(contextBody().querySelector("[data-rail-context-updated]")?.textContent).toBe(
			"Last updated 16 hours ago. Send a message to refresh.",
		);
	});

	it("says the turn's end refreshes it while the session is working", async () => {
		await renderCards(contextInputs(SIXTEEN_HOURS_AGO(), true));

		expect(contextBody().querySelector("[data-rail-context-updated]")?.textContent).toBe(
			"Last updated 16 hours ago. Refreshes when this turn ends.",
		);
	});
});

describe("Context card breakdown", () => {
	beforeEach(openContextByDefault);

	const MCP_TOOLS = Array.from({length: 13}, (_, i) => ({
		name: `mcp__github__tool_${i}`,
		serverName: "github",
		tokens: 100 + i,
	}));

	const BREAKDOWN: ContextBreakdown = {
		categories: [
			{name: "System prompt", tokens: 3_100, kind: "used"},
			{name: "System tools", tokens: 14_500, kind: "used"},
			{name: "MCP server instructions", tokens: 1_500, kind: "used"},
			{name: "MCP tools (deferred)", tokens: 94_200, kind: "deferred"},
			{name: "System tools (deferred)", tokens: 26_700, kind: "deferred"},
			{name: "Custom agents", tokens: 1_200, kind: "used"},
			{name: "Memory files", tokens: 6_300, kind: "used"},
			{name: "Skills", tokens: 9_900, kind: "used"},
			{name: "Messages", tokens: 143_500, kind: "used"},
			{name: "Autocompact buffer", tokens: 33_000, kind: "buffer"},
			{name: "Free space", tokens: 787_000, kind: "free"},
		],
		totalTokens: 180_000,
		rawMaxTokens: 1_000_000,
		percentage: 18,
		mcpTools: MCP_TOOLS,
		memoryFiles: [
			{path: "/Users/alice/.claude/CLAUDE.md", type: "User", tokens: 1_200},
			{
				path: "/Users/alice/.claude/projects/-Users-alice-projects-avalonlogs/memory/MEMORY.md",
				type: "AutoMem",
				tokens: 900,
			},
		],
		agents: [{agentType: "Explore", source: "built-in", tokens: 340}],
		fetchedAt: "2026-10-20T13:50:04.000Z",
		source: "context-command",
	};

	const INPUTS: SessionRailInputs = {
		...BASE,
		usage: {
			contextTokens: 180_000,
			contextWindowSize: 1_000_000,
			contextPercent: 18,
			fiveHour: null,
			weekly: null,
			updatedAt: null,
		},
		breakdown: BREAKDOWN,
	};

	function body(): HTMLElement {
		const found = screen.getByRole("region", {name: /^Context/}).querySelector<HTMLElement>("[data-rail-body]");
		if (!found) throw new Error("no Context body");
		return found;
	}

	function legendRows(): string[][] {
		return [...body().querySelectorAll("[data-rail-context-row]")].map((row) =>
			[...row.children].map((cell) => cell.textContent),
		);
	}

	function toggle(label: string): HTMLElement {
		return within(body()).getByRole("button", {name: new RegExp(`^${label}\\d+$`)});
	}

	it("headlines the breakdown's used tokens over a stacked meter", async () => {
		await renderCards(INPUTS);

		const meter = within(body()).getByRole("img", {name: /^Context window/});
		expect({
			headline: body().querySelector("[data-rail-context-summary]")?.parentElement?.textContent,
			label: meter.getAttribute("aria-label"),
			tabIndex: meter.tabIndex,
			className: meter.className,
			height: meter.style.height,
			track: meter.style.backgroundColor,
			segments: [...meter.children].map((segment) => (segment as HTMLElement).style.backgroundColor),
		}).toStrictEqual({
			headline: "18% used180k / 1M",
			label: "Context window: Messages: 143.5k, 14%; System tools: 14.5k, 1.5%; Skills: 9.9k, 0.99%; Memory files: 6.3k, 0.63%; Other: 5.8k, 0.58%; Autocompact buffer: 33k, 3.3%",
			tabIndex: 0,
			className:
				"relative w-full overflow-hidden rounded-full outline-none focus-visible:outline-hidden focus-visible:shadow-focus shrink-0",
			height: "4px",
			track: "var(--chart-reference-tint)",
			segments: [
				"var(--chart-categorical-1)",
				"var(--chart-categorical-2)",
				"var(--chart-categorical-3)",
				"var(--chart-categorical-4)",
				"var(--chart-reference)",
				"var(--chart-muted)",
			],
		});
	});

	it("lists used rows, buffer and free space, then deferred rows, in upstream's legend order", async () => {
		await renderCards(INPUTS);

		expect(legendRows()).toStrictEqual([
			["", "Messages", "143.5k", "14.4%"],
			["", "System tools", "14.5k", "1.5%"],
			["", "Skills", "9.9k", "1.0%", "Manage skills"],
			["", "Memory files", "6.3k", "0.6%", "Edit memory files"],
			["", "System prompt", "3.1k", "0.3%"],
			["", "MCP server instructions", "1.5k", "0.2%"],
			["", "Custom agents", "1.2k", "0.1%", "View custom agents"],
			["", "Autocompact buffer", "33k", "3.3%"],
			["", "Free space", "787k", "78.7%"],
			["", "MCP tools (deferred)", "94.2k", "—"],
			["", "System tools (deferred)", "26.7k", "—"],
		]);
	});

	it("draws each row's swatch in its meter series color, folded rows in the reference color", async () => {
		await renderCards(INPUTS);

		expect(
			[...body().querySelectorAll("[data-rail-context-row]")].map(
				(row) => row.querySelector<HTMLElement>("[data-rail-context-swatch]")?.style.background,
			),
		).toStrictEqual([
			"var(--chart-categorical-1)",
			"var(--chart-categorical-2)",
			"var(--chart-categorical-3)",
			"var(--chart-categorical-4)",
			"var(--chart-reference)",
			"var(--chart-reference)",
			"var(--chart-reference)",
			"var(--chart-muted)",
			"var(--chart-reference-tint)",
			"var(--chart-muted)",
			"var(--chart-muted)",
		]);
	});

	it("mutes deferred rows' names and percents", async () => {
		await renderCards(INPUTS);

		const deferred = [...body().querySelectorAll("[data-rail-context-row]")].at(-1);
		expect([...(deferred?.children ?? [])].map((cell) => cell.className)).toStrictEqual([
			"flex w-3 shrink-0 items-center justify-center",
			"min-w-0 flex-1 truncate text-ink-muted",
			"shrink-0 tabular-nums text-ink-muted",
			"w-11 shrink-0 text-end tabular-nums text-ink-muted",
		]);
	});

	it("links the Skills row to the skills page", async () => {
		await renderCards(INPUTS);

		expect(
			within(body())
				.getByRole("link", {name: /^Skills/})
				.getAttribute("href"),
		).toBe("/customize/skills");
	});

	it("opens the MCP tools expander, scrolling a list of more than 12 rows", async () => {
		await renderCards(INPUTS);

		const mcp = toggle("MCP tools");
		expect(mcp.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(mcp);

		const list = mcp.nextElementSibling?.firstElementChild;
		expect({
			expanded: mcp.getAttribute("aria-expanded"),
			count: mcp.textContent,
			list: list?.className,
			first: list?.firstElementChild?.textContent,
		}).toStrictEqual({
			expanded: "true",
			count: "MCP tools13",
			list: "flex flex-col max-h-60 overflow-y-auto overscroll-contain",
			first: "github · tool_0100",
		});
	});

	it("reveals and focuses the Custom agents expander from its action row", async () => {
		await renderCards(INPUTS);

		fireEvent.click(within(body()).getByRole("button", {name: /^Custom agents.*View custom agents/}));

		const agents = toggle("Custom agents");
		expect({
			expanded: agents.getAttribute("aria-expanded"),
			focused: document.activeElement === agents,
		}).toStrictEqual({expanded: "true", focused: true});
	});

	it("links auto-memory files from the Memory files expander", async () => {
		await renderCards(INPUTS);

		fireEvent.click(within(body()).getByRole("button", {name: /^Memory files.*Edit memory files/}));

		const memory = toggle("Memory files");
		const list = memory.nextElementSibling?.firstElementChild;
		expect({
			focused: document.activeElement === memory,
			rows: [...(list?.children ?? [])].map((row) => [
				row.textContent,
				row.querySelector("a")?.getAttribute("href") ?? null,
			]),
		}).toStrictEqual({
			focused: true,
			rows: [
				["/Users/alice/.claude/CLAUDE.md1.2k", null],
				[
					"/Users/alice/.claude/projects/-Users-alice-projects-avalonlogs/memory/MEMORY.md900",
					"/memory/-Users-alice-projects-avalonlogs/MEMORY",
				],
			],
		});
	});

	it("ignores a held Enter's auto-repeat on an expander toggle", async () => {
		await renderCards(INPUTS);

		const mcp = toggle("MCP tools");
		const notPrevented = fireEvent.keyDown(mcp, {key: "Enter", repeat: true});
		expect({notPrevented, expanded: mcp.getAttribute("aria-expanded")}).toStrictEqual({
			notPrevented: false,
			expanded: "false",
		});
	});

	describe("footer", () => {
		const SIXTEEN_HOURS_LATER = new Date(Date.parse(BREAKDOWN.fetchedAt) + 16 * 3_600_000);

		beforeEach(() => {
			vi.useFakeTimers({toFake: ["Date"]});
			vi.setSystemTime(SIXTEEN_HOURS_LATER);
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		async function footer(source: ContextBreakdown["source"], working: boolean) {
			await renderCards({...INPUTS, working, breakdown: {...BREAKDOWN, source}});
			const found = body().querySelector("[data-rail-context-updated]");
			return {
				text: found?.textContent,
				dateTime: found?.querySelector("time")?.getAttribute("datetime"),
				className: found?.className,
			};
		}

		const className = "mt-1 px-1 pb-1 text-[12px]/[15px] text-secondary";

		it("dates a /context breakdown by its run and says a new run refreshes it", async () => {
			const results = [await footer("context-command", false)];
			cleanup();
			results.push(await footer("context-command", true));
			expect(results).toStrictEqual([
				{
					text: "Last updated 16 hours ago. Run /context to refresh.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
				{
					text: "Last updated 16 hours ago. Run /context to refresh.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
			]);
		});

		it("says a message refreshes a mod breakdown, or the turn's end while working", async () => {
			const results = [await footer("mod", false)];
			cleanup();
			results.push(await footer("mod", true));
			expect(results).toStrictEqual([
				{
					text: "Last updated 16 hours ago. Send a message to refresh.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
				{
					text: "Last updated 16 hours ago. Refreshes when this turn ends.",
					dateTime: BREAKDOWN.fetchedAt,
					className,
				},
			]);
		});
	});
});
