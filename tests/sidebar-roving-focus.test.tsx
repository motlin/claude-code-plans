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
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionGroups} from "../src/components/sidebar/session-groups";
import {ToastProvider} from "../src/components/toast";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS} from "../src/lib/session-groups";
import {__unreadStoreTesting, syncUnseenFromSummaries} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";

const MINUTE = 60 * 1000;

function session(id: string, title: string, minutesAgo: number) {
	const mtime = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
	return {
		id,
		title,
		mtime,
		created: mtime,
		project: `-projects-${id}`,
		projectName: `project-${id}`,
		messageCount: 4,
		archived: false,
		state: "idle",
		bucket: "done",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

const FIXTURE = [session("s1", "First row", 1), session("s2", "Second row", 2), session("s3", "Third row", 3)];

async function renderGroups(activeItemId: string | null = null) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
		pages: [RecentSessionsResponse.parse({sessions: FIXTURE, nextCursor: null})],
		pageParams: [null],
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<div data-testid="list">
						<SessionGroups
							activeItemId={activeItemId}
							prefs={{...DEFAULT_SESSION_LIST_PREFS, groupBy: "state"}}
						/>
					</div>
					<Outlet />
				</ToastProvider>
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
	const result = render(<RouterProvider router={router} />);
	await waitFor(() => expect(result.container.querySelector("a[data-row-main-button]")).toBeTruthy());
	return result;
}

function rowLink(title: string): HTMLElement {
	const link = screen.getByText(title).closest("a[data-row-main-button]");
	if (!(link instanceof HTMLElement)) throw new Error(`no row ${title}`);
	return link;
}

/** Every element Tab would stop on inside the list, in DOM order. */
function tabStops(): HTMLElement[] {
	const list = screen.getByTestId("list");
	return [...list.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex]")].filter(
		(element) => element.tabIndex >= 0 && element.closest("[inert]") === null && !element.hasAttribute("disabled"),
	);
}

function label(element: Element | null): string {
	return element?.getAttribute("aria-label") ?? element?.textContent ?? "";
}

describe("sidebar session list roving focus", () => {
	beforeEach(() => {
		installLocalStorage();
	});

	afterEach(() => {
		cleanup();
	});

	it("has exactly one tab stop: the first item when nothing is selected", async () => {
		await renderGroups();

		expect(tabStops().map(label)).toEqual([label(screen.getByRole("button", {name: "Completed"}))]);
	});

	it("puts the tab stop on the selected row", async () => {
		await renderGroups("s2");

		expect(tabStops()).toEqual([rowLink("Second row")]);
	});

	it("moves focus between rows and group toggles with the arrow keys, Home and End", async () => {
		await renderGroups();
		const toggle = screen.getByRole("button", {name: "Completed"});

		rowLink("First row").focus();
		fireEvent.keyDown(document.activeElement!, {key: "ArrowDown"});
		expect(document.activeElement).toBe(rowLink("Second row"));
		expect(tabStops()).toEqual([rowLink("Second row")]);

		fireEvent.keyDown(document.activeElement!, {key: "ArrowUp"});
		fireEvent.keyDown(document.activeElement!, {key: "ArrowUp"});
		expect(document.activeElement).toBe(toggle);

		fireEvent.keyDown(document.activeElement!, {key: "ArrowDown"});
		expect(document.activeElement).toBe(rowLink("First row"));

		fireEvent.keyDown(document.activeElement!, {key: "End"});
		expect(document.activeElement).toBe(rowLink("Third row"));

		fireEvent.keyDown(document.activeElement!, {key: "ArrowDown"});
		expect(document.activeElement).toBe(rowLink("Third row"));

		fireEvent.keyDown(document.activeElement!, {key: "Home"});
		expect(document.activeElement).toBe(toggle);
		expect(tabStops()).toEqual([toggle]);
	});

	it("takes row kebabs and unread status glyphs out of the tab order but keeps them clickable", async () => {
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(FIXTURE.map(({id}) => ({id, unseen: true})));
		await renderGroups();

		const kebabs = screen.getAllByRole("button", {name: /^More options for /});
		const glyphs = screen.getAllByRole("button", {name: "Click to mark as read"});
		expect(kebabs.map((kebab) => kebab.getAttribute("tabindex"))).toEqual(["-1", "-1", "-1"]);
		expect(glyphs.map((glyph) => glyph.getAttribute("tabindex"))).toEqual(["-1", "-1", "-1"]);

		fireEvent.click(kebabs[0]!);
		expect(await screen.findByRole("menu")).toBeTruthy();
	});

	it("opens the focused row's menu with Shift+F10", async () => {
		await renderGroups();

		rowLink("Second row").focus();
		fireEvent.keyDown(document.activeElement!, {key: "F10", shiftKey: true});

		const menu = await screen.findByRole("menu");
		expect(menu).toBeTruthy();
		expect(screen.getByRole("button", {name: "More options for Second row"}).getAttribute("aria-expanded")).toBe(
			"true",
		);
	});

	it("opens the focused row's menu with the Menu key", async () => {
		await renderGroups();

		rowLink("Third row").focus();
		fireEvent.keyDown(document.activeElement!, {key: "ContextMenu"});

		expect(await screen.findByRole("menu")).toBeTruthy();
		expect(screen.getByRole("button", {name: "More options for Third row"}).getAttribute("aria-expanded")).toBe(
			"true",
		);
	});
});
