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
import {ToastProvider} from "../src/components/toast";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {SidebarSessionGroups} from "../src/components/sidebar/session-filter-menu";
import {RecentSessionsResponse, recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {DEFAULT_SESSION_LIST_PREFS, type SessionListPrefs} from "../src/lib/session-groups";
import type {SessionBucket} from "../src/lib/session-state";
import {installLocalStorage} from "./fake-storage";

const MINUTE = 60 * 1000;
const routerRef: {current: {state: {location: {pathname: string}}} | null} = {current: null};
const PREFS_KEY = "ccp-session-list-prefs";

function session(id: string, title: string, bucket: SessionBucket, projectName: string) {
	const mtime = new Date(Date.now() - MINUTE).toISOString();
	return {
		id,
		title,
		mtime,
		created: mtime,
		project: `-projects-${projectName}`,
		projectName,
		messageCount: 4,
		archived: false,
		state: bucket === "working" ? "working" : bucket === "blocked" ? "waiting" : "idle",
		bucket,
		liveAgentCount: 0,
		unseen: bucket === "review",
		blockedSince: null,
	};
}

const FIXTURE = [session("w1", "Working one", "working", "beta"), session("d1", "Completed one", "done", "alpha")];

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function storePrefs(prefs: Partial<SessionListPrefs>) {
	localStorage.setItem(PREFS_KEY, JSON.stringify({...DEFAULT_SESSION_LIST_PREFS, ...prefs}));
}

function storedPrefs(): unknown {
	const raw = localStorage.getItem(PREFS_KEY);
	return raw === null ? null : JSON.parse(raw);
}

async function renderSidebarGroups(
	fixture: readonly object[] = FIXTURE,
	fixtureByStatus: Partial<Record<SessionListPrefs["statusFilter"], readonly object[]>> = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	// Each Status value is its own server query (archived sessions are filtered server-side).
	for (const status of ["active", "archived", "all"] as const) {
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions(undefined, status).queryKey, {
			pages: [RecentSessionsResponse.parse({sessions: fixtureByStatus[status] ?? fixture, nextCursor: null})],
			pageParams: [null],
		});
	}
	const rootRoute = createRootRoute({
		component: () => (
			<SettingsProvider>
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SidebarSessionGroups activeItemId={null} />
						<Outlet />
					</ToastProvider>
				</QueryClientProvider>
			</SettingsProvider>
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
	const sessionsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/sessions",
		component: () => <p>All sessions page</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute, sessionRoute, sessionsRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	const result = render(<RouterProvider router={router} />);
	routerRef.current = router;
	await waitFor(() => {
		expect(result.container.querySelector("[data-sidebar-group-label]")).toBeTruthy();
	});
	await flush();
	return result;
}

function groupNames(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-group-name]')].map(
		(node) => node.textContent,
	);
}

function filterButton(): HTMLElement {
	const [first] = screen.getAllByRole("button", {name: "Group and sort"});
	if (first === undefined) throw new Error("Expected a Group and sort button");
	return first;
}

async function openFilterMenu(): Promise<HTMLElement> {
	fireEvent.click(filterButton());
	await flush();
	return screen.getByRole("menu");
}

function menuOutline(menu: HTMLElement): string[] {
	return [
		...menu.querySelectorAll(
			':scope [role="menuitem"], :scope [role="menuitemcheckbox"], :scope [role="menuitemradio"], :scope [role="separator"], :scope [data-menu-label]',
		),
	].map((node) => (node.getAttribute("role") === "separator" ? "---" : node.textContent.trim()));
}

async function openSubmenu(name: RegExp): Promise<HTMLElement> {
	const trigger = screen.getByRole("menuitem", {name});
	act(() => {
		trigger.focus();
	});
	fireEvent.keyDown(trigger, {key: "ArrowRight"});
	await flush();
	const menus = screen.getAllByRole("menu");
	const submenu = menus.at(-1);
	if (submenu === undefined) throw new Error("Expected a submenu");
	return submenu;
}

afterEach(cleanup);

beforeEach(() => {
	installLocalStorage();
});

describe("sidebar Group and sort menu", () => {
	it("puts Group and sort on every section header, revealed on hover, and an always-visible New session + on the first", async () => {
		const {container} = await renderSidebarGroups();

		const headers = [...container.querySelectorAll('[data-testid="sidebar-recents"] [data-sidebar-group-label]')];
		expect({
			groupAndSort: headers.map(
				(header) => header.querySelectorAll('button[aria-label="Group and sort"]').length,
			),
			newSession: headers.map((header) => header.querySelectorAll('button[aria-label="New session"]').length),
			revealed: filterButton()
				.closest("[data-header-reveal]")
				?.className.split(" ")
				.filter((name) => name === "w-0" || name === "group-hover/labelrow:w-auto"),
		}).toStrictEqual({groupAndSort: [1, 1], newSession: [1, 0], revealed: ["w-0", "group-hover/labelrow:w-auto"]});
	});

	it("styles the trigger like upstream: radius 6 (r5), secondary ink", async () => {
		await renderSidebarGroups();

		const classes = filterButton().className.split(" ");
		expect({
			radius: classes.filter((token) => token.startsWith("rounded")),
			ink: classes.filter((token) => /^text-(primary|secondary|ink-muted|muted)$/.test(token)),
		}).toStrictEqual({radius: ["rounded-r5"], ink: ["text-secondary"]});
	});

	it("lists upstream's top level: Group by, Sort by, Show, New section, Reset to defaults and View all", async () => {
		await renderSidebarGroups();
		const menu = await openFilterMenu();

		expect(menuOutline(menu)).toEqual([
			"Group byStatus",
			"Sort byLast updated",
			"Show",
			"---",
			"New section",
			"---",
			"Reset to defaults",
			"View all",
		]);
	});

	it("offers upstream's Group by order, with Folder standing in for Environment and Custom groups after it", async () => {
		await renderSidebarGroups();
		await openFilterMenu();
		await openSubmenu(/^Group by/);

		expect(
			screen.getAllByRole("menuitemradio").map((node) => [node.textContent, node.getAttribute("aria-checked")]),
		).toEqual([
			["None", "false"],
			["Status", "true"],
			["Date", "false"],
			["Folder", "false"],
			["Custom groups", "false"],
		]);
	});

	it("sorts by Last updated or Date created, keeping the local Name sort, then Descending or Ascending", async () => {
		await renderSidebarGroups();
		await openFilterMenu();
		await openSubmenu(/^Sort by/);

		expect(
			screen.getAllByRole("menuitemradio").map((node) => [node.textContent, node.getAttribute("aria-checked")]),
		).toEqual([
			["Last updated", "true"],
			["Date created", "false"],
			["Name", "false"],
			["Descending", "true"],
			["Ascending", "false"],
		]);

		fireEvent.click(screen.getByRole("menuitemradio", {name: "Ascending"}));
		await flush();
		expect(storedPrefs()).toEqual({...DEFAULT_SESSION_LIST_PREFS, sortDirection: "asc"});
	});

	it("keeps the local Status and Last activity filters and the empty-group and PR toggles under Show", async () => {
		const withPr = [
			...FIXTURE,
			{...session("p1", "PR one", "review", "alpha"), prStatus: {number: 6, state: "draft"}},
		];
		await renderSidebarGroups(withPr);
		await openFilterMenu();
		const show = await openSubmenu(/^Show/);

		expect(menuOutline(show)).toEqual([
			"Empty groups",
			"PR status",
			"---",
			"Status",
			"Active",
			"Archived",
			"All",
			"---",
			"Last activity",
			"1d",
			"3d",
			"7d",
			"30d",
			"All",
		]);
	});

	it("marks non-default trailing values in accent", async () => {
		storePrefs({groupBy: "project"});
		await renderSidebarGroups();
		await openFilterMenu();

		const accentOf = (name: RegExp) =>
			screen
				.getByRole("menuitem", {name})
				.querySelector("[data-menu-value]")
				?.className.includes("text-accent-100");
		expect([accentOf(/^Sort by/), accentOf(/^Group by/)]).toEqual([false, true]);
	});

	it("regroups the list and persists when a Group by option is chosen", async () => {
		const {container} = await renderSidebarGroups();
		expect(groupNames(container)).toEqual(["Working", "Completed"]);

		await openFilterMenu();
		await openSubmenu(/^Group by/);
		fireEvent.click(screen.getByRole("menuitemradio", {name: "Folder"}));
		await flush();

		expect(groupNames(container)).toEqual(["alpha", "beta"]);
		expect(storedPrefs()).toEqual({...DEFAULT_SESSION_LIST_PREFS, groupBy: "project"});
	});

	it("filters by Status from Show and persists it", async () => {
		await renderSidebarGroups();
		await openFilterMenu();
		await openSubmenu(/^Show/);
		const [statusAll] = screen.getAllByRole("menuitemradio", {name: "All"});
		if (statusAll === undefined) throw new Error("Expected Status ▸ All");
		fireEvent.click(statusAll);
		await flush();

		expect(storedPrefs()).toEqual({...DEFAULT_SESSION_LIST_PREFS, statusFilter: "all"});
	});

	it("shows no PR glyph by default, as upstream, and persists turning PR status on from Show", async () => {
		const withPr = [
			...FIXTURE,
			{...session("p1", "PR one", "review", "alpha"), prStatus: {number: 6, state: "draft"}},
		];
		const {container} = await renderSidebarGroups(withPr);
		const glyph = () => container.querySelector('[role="img"][aria-label="#6 · Draft"]') !== null;
		expect(glyph()).toBe(false);
		await openFilterMenu();
		await openSubmenu(/^Show/);
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "PR status"}));
		await flush();

		expect({glyph: glyph(), stored: storedPrefs()}).toStrictEqual({
			glyph: true,
			stored: {...DEFAULT_SESSION_LIST_PREFS, showPrStatus: true},
		});
	});
	it("resets every list preference with Reset to defaults", async () => {
		storePrefs({statusFilter: "all", activityDays: "1d", sortBy: "name", groupBy: "date"});
		await renderSidebarGroups();

		await openFilterMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Reset to defaults"}));
		await flush();

		expect(storedPrefs()).toEqual(DEFAULT_SESSION_LIST_PREFS);
	});

	it("opens the all-sessions page with View all", async () => {
		await renderSidebarGroups();
		await openFilterMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "View all"}));
		await flush();

		expect(routerRef.current?.state.location.pathname).toBe("/sessions");
	});

	it("starts a custom section from New section, switching the list to Custom groups", async () => {
		const {container} = await renderSidebarGroups();
		await openFilterMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "New section"}));
		await flush();

		fireEvent.change(screen.getByRole("textbox", {name: "Group name"}), {target: {value: "Reading"}});
		fireEvent.click(screen.getByRole("button", {name: "Create and group by custom"}));
		await flush();

		const stored = JSON.parse(localStorage.getItem("ccp-session-groups") ?? "{}") as {
			groups?: Array<{name: string}>;
		};
		expect({
			groupBy: (storedPrefs() as SessionListPrefs).groupBy,
			sections: stored.groups?.map((group) => group.name),
			// An empty section stays hidden until Show ▸ Empty groups is on.
			groups: groupNames(container),
		}).toStrictEqual({groupBy: "custom", sections: ["Reading"], groups: ["Ungrouped"]});
	});

	it("keeps the trigger on an empty-list header so Reset to defaults can bring the rows back", async () => {
		storePrefs({statusFilter: "archived"});
		const {container} = await renderSidebarGroups(FIXTURE, {archived: []});

		const recents = container.querySelector<HTMLElement>('[data-testid="sidebar-recents"]');
		expect({
			labels: [...(recents?.querySelectorAll("[data-sidebar-group-label]") ?? [])].map((node) =>
				node.textContent.trim(),
			),
			empty: recents?.querySelector("[data-sidebar-empty]")?.textContent,
		}).toStrictEqual({labels: ["Completed"], empty: "No sessions match the current filtersShow all sessions"});

		await openFilterMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Reset to defaults"}));
		await flush();

		expect({
			groups: groupNames(container),
			empty: container.querySelector("[data-sidebar-empty]"),
			stored: storedPrefs(),
		}).toStrictEqual({groups: ["Working", "Completed"], empty: null, stored: DEFAULT_SESSION_LIST_PREFS});
	});

	it("offers Show all sessions when the filters empty the list, as upstream does", async () => {
		storePrefs({statusFilter: "archived", activityDays: "1d"});
		const {container} = await renderSidebarGroups(FIXTURE, {archived: [], all: FIXTURE});
		const empty = container.querySelector<HTMLElement>("[data-sidebar-empty]");
		expect({
			text: empty?.querySelector("p")?.textContent,
			classes: empty?.className
				.split(" ")
				.filter((name) => ["items-center", "text-center", "py-6"].includes(name)),
		}).toStrictEqual({
			text: "No sessions match the current filters",
			classes: ["items-center", "py-6", "text-center"],
		});

		fireEvent.click(screen.getByRole("button", {name: "Show all sessions"}));
		await flush();

		expect(storedPrefs()).toEqual({...DEFAULT_SESSION_LIST_PREFS, statusFilter: "all", activityDays: "all"});
	});

	it("says Sessions you start will show up here when there are no sessions at all", async () => {
		const {container} = await renderSidebarGroups([]);
		expect({
			text: container.querySelector("[data-sidebar-empty]")?.textContent,
			showAll: screen.queryByRole("button", {name: "Show all sessions"}),
		}).toStrictEqual({text: "Sessions you start will show up here", showAll: null});
	});

	it("groups the list by this browser's custom groups in Custom groups mode", async () => {
		localStorage.setItem(
			"ccp-session-groups",
			JSON.stringify({
				groups: [
					{id: "cg-blog", name: "Blog"},
					{id: "cg-empty", name: "Someday"},
				],
				assignments: {d1: "cg-blog"},
				order: {},
			}),
		);
		storePrefs({groupBy: "custom"});
		const {container} = await renderSidebarGroups();

		expect(groupNames(container)).toEqual(["Blog", "Ungrouped"]);
	});
});
