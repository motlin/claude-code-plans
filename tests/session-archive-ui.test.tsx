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
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionActionsMenu} from "../src/components/session-actions-menu";
import {SessionTitleHeading} from "../src/components/session-title-heading";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {
	RecentSessionsResponse,
	recentSessionsInfiniteQueryOptions,
	type SessionListItem,
} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS, type SessionStatusFilter} from "../src/lib/session-groups";
import {__unreadStoreTesting} from "../src/lib/unread-store";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const ARCHIVED_URL = `/api/sessions/${SESSION_ID}/archived`;
// One clock reading for every fixture: per-call Date.now() gives later rows a newer mtime whenever a millisecond ticks between calls, which reorders the activity sort.
const FIXTURE_NOW = Date.now();

function listItem(overrides: Partial<SessionListItem> = {}): SessionListItem {
	return {
		id: SESSION_ID,
		title: "Fix the flaky test",
		mtime: new Date(FIXTURE_NOW - 60_000).toISOString(),
		created: new Date(FIXTURE_NOW - 120_000).toISOString(),
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "ended",
		bucket: "done",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function archiveCalls(): Array<{url: string; method: string | undefined}> {
	return fetchMock.mock.calls
		.map(([input, init]) => ({url: input, method: init?.method}))
		.filter((call) => call.url === ARCHIVED_URL);
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function newQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
			mutations: {retry: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	return queryClient;
}

async function renderWithRouter(content: ReactNode, queryClient: QueryClient = newQueryClient()) {
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					{content}
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	});
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
	const result = render(<RouterProvider router={router} />);
	await flush();
	return result;
}

async function openRowMenu(session: SessionListItem): Promise<HTMLElement> {
	await renderWithRouter(
		<SessionActionsMenu session={session}>
			<a href={`/session/${session.id}`}>Row title</a>
		</SessionActionsMenu>,
	);
	fireEvent.contextMenu(screen.getByText("Row title"), {clientX: 40, clientY: 50});
	await flush();
	return screen.getByRole("menu");
}

function lifecycleItems(menu: HTMLElement): string[] {
	return [...menu.querySelectorAll('[role="menuitem"]')]
		.filter((node) => node.getAttribute("aria-keyshortcuts") === "a")
		.map((node) => node.textContent ?? "");
}

function toastTexts(): string[] {
	return [...document.querySelectorAll("[data-toast]")].map((toast) => toast.textContent ?? "");
}

beforeEach(() => {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	fetchMock.mockReset();
	fetchMock.mockImplementation((_input, init) => Promise.resolve(Response.json({archived: init?.method === "PUT"})));
	vi.stubGlobal("fetch", fetchMock);
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(() => Promise.resolve());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("archive in the session row menu", () => {
	it("offers Archive A for an active session", async () => {
		const menu = await openRowMenu(listItem());

		expect(lifecycleItems(menu)).toEqual(["ArchiveA"]);
	});

	it("offers Unarchive for an archived session", async () => {
		const menu = await openRowMenu(listItem({archived: true}));

		expect(lifecycleItems(menu)).toEqual(["UnarchiveA"]);
	});

	it("archives on a, toasts with Undo, and Undo unarchives", async () => {
		const menu = await openRowMenu(listItem());

		fireEvent.keyDown(menu, {key: "a"});
		await waitFor(() => expect(toastTexts()).toEqual(["Archived 1 sessionUndo"]));
		expect(archiveCalls()).toEqual([{url: ARCHIVED_URL, method: "PUT"}]);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));
		await waitFor(() =>
			expect(archiveCalls()).toEqual([
				{url: ARCHIVED_URL, method: "PUT"},
				{url: ARCHIVED_URL, method: "DELETE"},
			]),
		);
		await waitFor(() => expect(toastTexts()).toEqual([]));
	});

	it("unarchives on a without an Undo toast", async () => {
		const menu = await openRowMenu(listItem({archived: true}));

		fireEvent.keyDown(menu, {key: "a"});
		await waitFor(() => expect(archiveCalls()).toEqual([{url: ARCHIVED_URL, method: "DELETE"}]));
		await flush();
		expect(toastTexts()).toEqual([]);
	});

	it("toasts an error when the archive request fails", async () => {
		fetchMock.mockResolvedValue(Response.json({error: "boom"}, {status: 500}));
		const menu = await openRowMenu(listItem());

		fireEvent.keyDown(menu, {key: "a"});

		await waitFor(() => expect(toastTexts()).toEqual(["Couldn’t archive the session. Try again."]));
	});
});

describe("⌥⌘A on the session page", () => {
	it("archives the session and toasts with Undo", async () => {
		await renderWithRouter(
			<SessionTitleHeading sessionId={SESSION_ID} title="Fix the flaky test" archived={false} />,
		);

		fireEvent.keyDown(document.body, {key: "å", code: "KeyA", metaKey: true, altKey: true});

		await waitFor(() => expect(toastTexts()).toEqual(["Archived 1 sessionUndo"]));
		expect(archiveCalls()).toEqual([{url: ARCHIVED_URL, method: "PUT"}]);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));
		await waitFor(() =>
			expect(archiveCalls()).toEqual([
				{url: ARCHIVED_URL, method: "PUT"},
				{url: ARCHIVED_URL, method: "DELETE"},
			]),
		);
	});

	it("unarchives an archived session and shows its Archived badge", async () => {
		await renderWithRouter(<SessionTitleHeading sessionId={SESSION_ID} title="Fix the flaky test" archived />);
		expect(screen.getByText("Archived").hasAttribute("data-archived-badge")).toBe(true);

		fireEvent.keyDown(document.body, {key: "å", code: "KeyA", metaKey: true, altKey: true});

		await waitFor(() => expect(archiveCalls()).toEqual([{url: ARCHIVED_URL, method: "DELETE"}]));
	});
});

describe("Status ▸ Archived in the sidebar", () => {
	async function renderSidebar(statusFilter: SessionStatusFilter, sessions: SessionListItem[]) {
		const queryClient = newQueryClient();
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions(undefined, statusFilter).queryKey, {
			pages: [RecentSessionsResponse.parse({sessions, nextCursor: null})],
			pageParams: [null],
		});
		return renderWithRouter(
			<SessionGroups activeItemId={null} prefs={{...DEFAULT_SESSION_LIST_PREFS, statusFilter}} />,
			queryClient,
		);
	}

	function rows(container: HTMLElement): string[] {
		return [...container.querySelectorAll("a[data-row-main-button]")].map((row) => row.textContent ?? "");
	}

	it("shows archived rows with an Archived badge", async () => {
		const {container} = await renderSidebar("archived", [listItem({archived: true, title: "Old spike"})]);

		expect(rows(container)).toEqual(["Old spikeArchived"]);
	});

	it("badges only the archived rows under All", async () => {
		const {container} = await renderSidebar("all", [
			listItem({id: "a1", title: "Still going"}),
			listItem({id: "a2", archived: true, title: "Old spike"}),
		]);

		expect(rows(container)).toEqual(["Still going", "Old spikeArchived"]);
	});
});
