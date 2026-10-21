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
		await renderCards(BASE);

		expect({
			cards: cards(),
			context: screen.getByRole("region", {name: /^Context/}).querySelector("[data-rail-body]")?.textContent,
		}).toStrictEqual({
			cards: [
				["environment", null],
				["context", null],
			],
			context: "Send a message to see context usage.",
		});
	});

	it("renders every card with content in upstream's order, with its summary", async () => {
		await renderCards(FULL, seed);

		expect(cards()).toStrictEqual([
			["environment", null],
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
		fireEvent.click(screen.getByRole("button", {name: /^Background tasks/}));
		fireEvent.click(screen.getByRole("button", {name: /^Run the dev server/}));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		expect(
			within(screen.getByRole("region", {name: "Background tasks"})).getByText("tasks pane body").tagName,
		).toBe("P");
	});
});

describe("Context card", () => {
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
