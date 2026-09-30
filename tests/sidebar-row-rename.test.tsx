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

import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ToastProvider} from "../src/components/toast";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS} from "../src/lib/session-groups";
import {__unreadStoreTesting} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "r1";
const OLD_TITLE = "Fix the flaky test";
const mtime = new Date(Date.now() - 60_000).toISOString();

const FIXTURE = [
	{
		id: SESSION_ID,
		title: OLD_TITLE,
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

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function renameCalls(): Array<{url: string; method: string | undefined; body: unknown}> {
	return fetchMock.mock.calls
		.filter(([input]) => input.endsWith("/title"))
		.map(([input, init]) => ({
			url: input,
			method: init?.method,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
		}));
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderSidebar() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
			mutations: {retry: false},
		},
	});
	queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
		pages: [RecentSessionsResponse.parse({sessions: FIXTURE, nextCursor: null})],
		pageParams: [null],
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SessionGroups activeItemId={null} prefs={{...DEFAULT_SESSION_LIST_PREFS, groupBy: "state"}} />
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({getParentRoute: () => rootRoute, path: "/", component: () => null});
	const sessionRoute = createRoute({getParentRoute: () => rootRoute, path: "/session/$id", component: () => null});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute, sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	const result = render(<RouterProvider router={router} />);
	await waitFor(() => expect(result.container.querySelector("a[data-row-main-button]")).toBeTruthy());
	return {...result, router};
}

function rowLink(): HTMLElement {
	const link = document.querySelector("a[data-row-main-button]");
	if (!(link instanceof HTMLElement)) throw new Error("no row");
	return link;
}

async function openKebabMenu(): Promise<void> {
	fireEvent.click(screen.getByRole("button", {name: `More options for ${OLD_TITLE}`}));
	await flush();
	await waitFor(() => screen.getByRole("menu"));
}

async function openContextMenu(): Promise<void> {
	fireEvent.contextMenu(rowLink(), {clientX: 40, clientY: 50});
	await flush();
	await waitFor(() => screen.getByRole("menu"));
}

async function chooseRename(): Promise<HTMLInputElement> {
	fireEvent.click(screen.getByRole("menuitem", {name: /Rename/}));
	await flush();
	await flush();
	return (await waitFor(() => screen.getByRole("textbox", {name: "Rename"}))) as HTMLInputElement;
}

function inputState(input: HTMLInputElement) {
	return {
		focused: document.activeElement === input,
		value: input.value,
		selection: [input.selectionStart, input.selectionEnd],
		menuOpen: screen.queryByRole("menu") !== null,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	installLocalStorage();
	fetchMock.mockReset();
	fetchMock.mockImplementation((input, init) =>
		Promise.resolve(
			input.endsWith("/title")
				? Response.json({customTitle: "Renamed row", title: "Renamed row"})
				: Response.json({archived: init?.method === "PUT"}),
		),
	);
	vi.stubGlobal("fetch", fetchMock);
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(() => Promise.resolve());
});

describe("sidebar row rename", () => {
	it("Rename from the kebab focuses an inline input holding the selected title", async () => {
		await renderSidebar();
		await openKebabMenu();

		const input = await chooseRename();

		expect(inputState(input)).toStrictEqual({
			focused: true,
			value: OLD_TITLE,
			selection: [0, OLD_TITLE.length],
			menuOpen: false,
		});
	});

	it("Rename from the context menu focuses the inline input", async () => {
		await renderSidebar();
		await openContextMenu();

		const input = await chooseRename();

		expect(inputState(input)).toStrictEqual({
			focused: true,
			value: OLD_TITLE,
			selection: [0, OLD_TITLE.length],
			menuOpen: false,
		});
	});

	it("Enter commits through the rename mutation and shows the new title", async () => {
		await renderSidebar();
		await openKebabMenu();
		const input = await chooseRename();

		fireEvent.change(input, {target: {value: "Renamed row"}});
		fireEvent.keyDown(input, {key: "Enter"});
		await flush();

		expect({calls: renameCalls(), row: rowLink().textContent}).toStrictEqual({
			calls: [{url: `/api/sessions/${SESSION_ID}/title`, method: "PUT", body: {title: "Renamed row"}}],
			row: "Renamed row",
		});
	});

	it("Escape cancels and restores the title", async () => {
		await renderSidebar();
		await openKebabMenu();
		const input = await chooseRename();

		fireEvent.change(input, {target: {value: "Discarded"}});
		fireEvent.keyDown(input, {key: "Escape"});
		await flush();

		expect({
			calls: renameCalls(),
			row: rowLink().textContent,
			input: screen.queryByRole("textbox", {name: "Rename"}),
		}).toStrictEqual({calls: [], row: OLD_TITLE, input: null});
	});

	it("blur cancels without saving", async () => {
		await renderSidebar();
		await openKebabMenu();
		const input = await chooseRename();

		fireEvent.change(input, {target: {value: "Discarded"}});
		fireEvent.blur(input);
		await flush();

		expect({
			calls: renameCalls(),
			row: rowLink().textContent,
			input: screen.queryByRole("textbox", {name: "Rename"}),
		}).toStrictEqual({calls: [], row: OLD_TITLE, input: null});
	});
});
