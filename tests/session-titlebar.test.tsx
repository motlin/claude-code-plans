// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionTitlebar} from "../src/components/session-titlebar";
import {ToastProvider} from "../src/components/toast";
import {SESSION_STICKY_HEADER_CLASS} from "../src/components/titlebar-classes";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {sessionOpenInQueryOptions, type SessionDetailData} from "../src/lib/api/sessions";
import {__unreadStoreTesting} from "../src/lib/unread-store";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const PARENT_ID = "0a1b2c3d-1111-4222-8333-944445555666";
const FORKED_FROM_ID = "fedcba98-1111-4222-8333-944445555666";
const TITLE = "Sync fork with upstream";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";

const baseDetail: SessionDetailData = {
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

const fullDetail: SessionDetailData = {
	...baseDetail,
	parentSessionId: PARENT_ID,
	attributionAgent: "code-reviewer",
	model: "claude-haiku-4-5-20251001",
	entrypoint: "sdk-ts",
	sessionKind: "background",
	teamNames: ["platform"],
	forkedFromSessionId: FORKED_FROM_ID,
	pr: {
		number: 42,
		url: "https://github.com/alice/avalonlogs/pull/42",
		repository: "alice/avalonlogs",
	},
};

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const openMock = vi.fn<typeof window.open>();

type ResizeCallback = (entries: Array<{contentRect: {width: number}}>) => void;
const resizeCallbacks: ResizeCallback[] = [];

class TestResizeObserver {
	constructor(callback: ResizeCallback) {
		resizeCallbacks.push(callback);
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function resizeTitlebar(width: number) {
	act(() => {
		for (const callback of resizeCallbacks) callback([{contentRect: {width}}]);
	});
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderTitlebar(data: SessionDetailData, slots: {withSlots?: boolean} = {}) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
			mutations: {retry: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
		cwd: data.cwd,
		bridgeSessionId: null,
	});
	const content: ReactNode = (
		<SessionTitlebar
			sessionId={SESSION_ID}
			data={data}
			isActive={false}
			{...(slots.withSlots
				? {
						paneToggles: (
							<button type="button" aria-label="Changes">
								C
							</button>
						),
						viewOptions: (
							<button type="button" aria-label="View options">
								V
							</button>
						),
					}
				: {})}
		/>
	);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>{content}</ToastProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [`/session/${SESSION_ID}`]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await flush();
	return screen.getByTestId("session-titlebar");
}

function accessibleName(element: Element): string {
	return element.getAttribute("aria-label") ?? element.textContent ?? "";
}

function controlsIn(container: Element): string[] {
	return [...container.querySelectorAll("button, a")].map(accessibleName);
}

beforeEach(() => {
	resizeCallbacks.length = 0;
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("open", openMock);
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => Response.json({ok: true}));
	writeText.mockReset();
	writeText.mockResolvedValue(undefined);
	openMock.mockReset();
	openMock.mockReturnValue(null);
	Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("SessionTitlebar layout", () => {
	it("orders the lead (parent, title, chevron, origin pills) before the trail slots", async () => {
		const titlebar = await renderTitlebar(fullDetail, {withSlots: true});
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		const trail = titlebar.querySelector("[data-titlebar-trail]");
		if (lead === null || trail === null) throw new Error("titlebar lead/trail missing");

		expect({
			height: titlebar.classList.contains("h-8"),
			lead: controlsIn(lead),
			pills: [...lead.querySelectorAll("[data-origin-pill]")].map(
				(pill) => `${pill.getAttribute("data-origin-pill")}:${pill.textContent}`,
			),
			trail: controlsIn(trail),
			trailFollowsLead: Boolean(lead.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING),
		}).toStrictEqual({
			height: true,
			lead: [
				"Environment",
				"Parent session",
				`${TITLE}, rename session`,
				`More options for ${TITLE}`,
				`Forked from ${FORKED_FROM_ID.slice(0, 8)}`,
			],
			pills: [
				"model:Haiku 4.5",
				"entrypoint:sdk-ts",
				"kind:background",
				"agent:code-reviewer",
				"team:platform",
				`forked-from:Forked from ${FORKED_FROM_ID.slice(0, 8)}`,
			],
			trail: ["Changes", "View options"],
			trailFollowsLead: true,
		});
	});

	it("leaves out the back pill and optional badges for a plain CLI session", async () => {
		const titlebar = await renderTitlebar({...baseDetail, entrypoint: "cli"});
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		if (lead === null) throw new Error("titlebar lead missing");

		expect({
			lead: controlsIn(lead),
			pills: [...lead.querySelectorAll("[data-origin-pill]")].map((pill) =>
				pill.getAttribute("data-origin-pill"),
			),
			allSessions: screen.queryByText("All Sessions"),
		}).toStrictEqual({
			lead: ["Environment", `${TITLE}, rename session`, `More options for ${TITLE}`],
			pills: [],
			allSessions: null,
		});
	});

	it("opens the header menu from the chevron", async () => {
		await renderTitlebar(baseDetail);
		fireEvent.click(screen.getByRole("button", {name: `More options for ${TITLE}`}));
		await flush();

		expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toStrictEqual([
			"Open in",
			"RenameR",
			"Copy linkC",
			"ForkF",
			"ArchiveA",
		]);
	});
});

describe("SessionTitlebar environment glyph", () => {
	it("shows upstream's 24px laptop glyph before the title", async () => {
		const titlebar = await renderTitlebar(baseDetail);
		const glyph = screen.getByRole("button", {name: "Environment"});
		const title = screen.getByRole("button", {name: `${TITLE}, rename session`});

		expect({
			inLead: titlebar.querySelector("[data-titlebar-lead]")?.contains(glyph),
			beforeTitle: Boolean(glyph.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING),
			size: ["size-6", "rounded-r5"].every((name) => glyph.classList.contains(name)),
			icon: glyph.querySelector("svg")?.classList.contains("lucide-laptop"),
		}).toStrictEqual({inLead: true, beforeTitle: true, size: true, icon: true});
	});

	it("opens upstream's Remote Control status with a Learn more link", async () => {
		await renderTitlebar(baseDetail);
		fireEvent.click(screen.getByRole("button", {name: "Environment"}));
		await flush();
		const status = document.querySelector("[data-environment-status]");
		const link = screen.getByRole("link", {name: "Learn more"});

		expect({
			status: status?.textContent,
			connected: status?.getAttribute("data-environment-status"),
			href: link.getAttribute("href"),
			target: link.getAttribute("target"),
		}).toStrictEqual({
			status: "Not connected via Remote Control. Learn more",
			connected: "disconnected",
			href: "https://code.claude.com/docs/en/remote-control",
			target: "_blank",
		});
	});
});

describe("SessionTitlebar chrome", () => {
	it("matches upstream's borderless 32px bar with a 13px/19px title and no project chip", async () => {
		const titlebar = await renderTitlebar(baseDetail);
		const title = screen.getByRole("button", {name: `${TITLE}, rename session`});
		const headerClasses = SESSION_STICKY_HEADER_CLASS.split(" ");

		expect({
			height: titlebar.classList.contains("h-8"),
			titleType: ["text-[13px]/[19px]", "font-medium"].every((name) => title.classList.contains(name)),
			projectChip: titlebar.querySelector("[data-origin-pill='project']"),
			projectButton: screen.queryByRole("button", {name: "avalonlogs"}),
			headerBorder: headerClasses.filter((name) => /^border(-|$)/.test(name)),
			headerBottomPadding: headerClasses.filter((name) => /^(pb|py|p)-/.test(name)),
		}).toStrictEqual({
			height: true,
			titleType: true,
			projectChip: null,
			projectButton: null,
			headerBorder: [],
			headerBottomPadding: [],
		});
	});
});

describe("SessionTitlebar pill collapse", () => {
	function compactState(titlebar: HTMLElement) {
		const lead = titlebar.querySelector("[data-titlebar-lead]");
		if (lead === null) throw new Error("titlebar lead missing");
		return {
			compact: lead.hasAttribute("data-pills-compact"),
			srOnlyLabels: [...lead.querySelectorAll("[data-origin-label]")].map((label) =>
				label.classList.contains("sr-only"),
			),
		};
	}

	it("collapses the origin pills to icons when the titlebar is narrow", async () => {
		const titlebar = await renderTitlebar({
			...baseDetail,
			model: "claude-haiku-4-5-20251001",
		});
		resizeTitlebar(1200);
		const wide = compactState(titlebar);
		resizeTitlebar(420);
		const narrow = compactState(titlebar);

		expect({wide, narrow}).toStrictEqual({
			wide: {compact: false, srOnlyLabels: [false]},
			narrow: {compact: true, srOnlyLabels: [true]},
		});
	});

	it("keeps the labels until the titlebar drops under 560px, upstream's tile-slot container query", async () => {
		const titlebar = await renderTitlebar({
			...baseDetail,
			model: "claude-haiku-4-5-20251001",
		});
		resizeTitlebar(600);
		const at600 = compactState(titlebar);
		resizeTitlebar(560);
		const at560 = compactState(titlebar);
		resizeTitlebar(559);
		const at559 = compactState(titlebar);

		expect({at600, at560, at559}).toStrictEqual({
			at600: {compact: false, srOnlyLabels: [false]},
			at560: {compact: false, srOnlyLabels: [false]},
			at559: {compact: true, srOnlyLabels: [true]},
		});
	});
});

describe("SessionTitlebar cost pill", () => {
	const costedDetail: SessionDetailData = {
		...baseDetail,
		costState: {
			totalCostUSD: 3.5,
			linesAdded: 120,
			linesRemoved: 30,
			apiDurationMs: 90_000,
			toolDurationMs: 12_000,
			hasUnknownModelCost: true,
			models: [
				{
					model: "claude-opus-5-5[1m]",
					costUSD: 3,
					inputTokens: 1_000,
					outputTokens: 2_000,
					cacheReadInputTokens: 30_000,
					cacheCreationInputTokens: 4_000,
				},
				{
					model: "claude-haiku-4-5-20251001",
					costUSD: 0.5,
					inputTokens: 10,
					outputTokens: 5,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
				},
			],
		},
	};

	it("leaves the pill out when the transcript has no cost-state", async () => {
		const titlebar = await renderTitlebar(baseDetail);

		expect(titlebar.querySelector('[data-origin-pill="cost"]')).toBe(null);
	});

	it("shows the total and opens the cost, lines and per-model breakdown", async () => {
		const titlebar = await renderTitlebar(costedDetail);
		const pill = titlebar.querySelector('[data-origin-pill="cost"]');
		fireEvent.click(screen.getByRole("button", {name: "Session cost: $3.50"}));
		await flush();

		expect({
			pill: pill?.textContent,
			rows: [...document.querySelectorAll("[data-cost-row]")].map((row) => [
				row.getAttribute("data-cost-row"),
				[...row.children].map((cell) => cell.textContent),
			]),
			note: document.querySelector("[data-cost-unknown]")?.textContent,
		}).toStrictEqual({
			pill: "$3.50",
			rows: [
				["total", ["Total cost", "$3.50"]],
				["lines", ["Lines changed", "+120 −30"]],
				["api", ["API time", "1m 30s"]],
				["tools", ["Tool time", "12.0s"]],
				["model", ["Opus 5.5", "$3.00", "1K in · 2K out · 30K cache read · 4K cache write"]],
				["model", ["Haiku 4.5", "$0.50", "10 in · 5 out"]],
			],
			note: "Some models have no known price, so the total is a floor.",
		});
	});
});
