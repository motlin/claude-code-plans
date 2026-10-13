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

import {SessionAiTitleLine} from "../src/components/session-ai-title-line";
import {STORAGE_KEYS} from "../src/components/settings-context";
import {SettingsProvider} from "../src/components/settings-provider";
import {SessionsSettings} from "../src/components/settings/settings-sections";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS} from "../src/lib/session-groups";
import {__unreadStoreTesting} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";

const RENAMED = "claude.ai";
const AI_TITLE = "Parallel do-task workstreams";

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	__unreadStoreTesting.reset();
});

function hideAiTitles() {
	localStorage.setItem(STORAGE_KEYS.showAiTitles, "false");
}

describe("session header AI title line", () => {
	function aiTitleLine(): {text: string | null | undefined; muted: boolean} | null {
		const line = document.querySelector("[data-session-ai-title]");
		if (line === null) return null;
		return {text: line.textContent, muted: line.className.includes("text-ink-muted")};
	}

	it("shows a differing AI title as a muted line under the renamed title", async () => {
		render(
			<SettingsProvider>
				<SessionAiTitleLine title={RENAMED} aiTitle={AI_TITLE} />
			</SettingsProvider>,
		);
		await act(async () => {});
		expect(aiTitleLine()).toStrictEqual({text: AI_TITLE, muted: true});
	});

	it("renders nothing when the AI title is the title", async () => {
		render(
			<SettingsProvider>
				<SessionAiTitleLine title={AI_TITLE} aiTitle={AI_TITLE} />
			</SettingsProvider>,
		);
		await act(async () => {});
		expect(aiTitleLine()).toBeNull();
	});

	it("renders nothing when Show AI titles is off", async () => {
		hideAiTitles();
		render(
			<SettingsProvider>
				<SessionAiTitleLine title={RENAMED} aiTitle={AI_TITLE} />
			</SettingsProvider>,
		);
		await act(async () => {});
		expect(aiTitleLine()).toBeNull();
	});
});

describe("sidebar session row AI title tooltip", () => {
	const mtime = new Date(Date.now() - 60_000).toISOString();
	const FIXTURE = [
		{
			id: "r1",
			title: RENAMED,
			aiTitle: AI_TITLE,
			mtime,
			created: mtime,
			project: "-projects-alpha",
			projectName: "alpha",
			messageCount: 4,
			archived: false,
			state: "idle",
			bucket: "done",
			liveAgentCount: 0,
			unseen: false,
			blockedSince: null,
		},
	];

	async function renderSidebar() {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
		);
		const queryClient = new QueryClient({
			defaultOptions: {queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false}},
		});
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
			pages: [RecentSessionsResponse.parse({sessions: FIXTURE, nextCursor: null})],
			pageParams: [null],
		});
		queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
		const rootRoute = createRootRoute({
			component: () => (
				<QueryClientProvider client={queryClient}>
					<SettingsProvider>
						<ToastProvider>
							<SessionGroups
								activeItemId={null}
								prefs={{...DEFAULT_SESSION_LIST_PREFS, groupBy: "state"}}
							/>
							<Outlet />
						</ToastProvider>
					</SettingsProvider>
				</QueryClientProvider>
			),
		});
		const homeRoute = createRoute({getParentRoute: () => rootRoute, path: "/", component: () => null});
		const sessionRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/session/$id",
			component: () => null,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
			history: createMemoryHistory({initialEntries: ["/"]}),
		});
		await router.load();
		render(<RouterProvider router={router} />);
		await waitFor(() => {
			expect(document.querySelector("a[data-row-main-button]")).toBeTruthy();
		});
	}

	async function hoverCard(): Promise<Element> {
		const row = document.querySelector("[data-hover-card-trigger]");
		if (row === null) throw new Error("no hover trigger");
		act(() => {
			fireEvent.pointerEnter(row, {pointerType: "mouse"});
			fireEvent.mouseEnter(row);
			fireEvent.mouseMove(row);
		});
		return waitFor(
			() => {
				const card = document.querySelector("[data-session-hover-card]");
				if (card === null) throw new Error("card closed");
				return card;
			},
			{timeout: 2000},
		);
	}

	it("includes the AI title in the row's hover card", async () => {
		await renderSidebar();
		const card = await hoverCard();
		expect({
			title: card.querySelector("[data-card-title]")?.textContent,
			aiTitle: card.querySelector("[data-card-ai-title]")?.textContent,
		}).toStrictEqual({title: RENAMED, aiTitle: AI_TITLE});
	});

	it("leaves the AI title out of the hover card when Show AI titles is off", async () => {
		hideAiTitles();
		await renderSidebar();
		const card = await hoverCard();
		expect({
			title: card.querySelector("[data-card-title]")?.textContent,
			aiTitle: card.querySelector("[data-card-ai-title]"),
		}).toStrictEqual({title: RENAMED, aiTitle: null});
	});
});

describe("Settings ▸ Sessions ▸ Show AI titles", () => {
	it("defaults on and persists turning it off", async () => {
		render(
			<SettingsProvider>
				<SessionsSettings />
			</SettingsProvider>,
		);
		await act(async () => {});
		const toggle = screen.getByRole("switch", {name: "Show AI titles"});
		const before = toggle.getAttribute("aria-checked");
		act(() => {
			fireEvent.click(toggle);
		});
		expect({
			before,
			after: toggle.getAttribute("aria-checked"),
			stored: localStorage.getItem(STORAGE_KEYS.showAiTitles),
		}).toStrictEqual({before: "true", after: "false", stored: "false"});
	});
});
