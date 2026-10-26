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
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {DEFAULTS} from "../src/components/settings-context";
import {SettingsProvider} from "../src/components/settings-provider";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {SessionGroups} from "../src/components/sidebar/session-groups";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {ToastProvider} from "../src/components/toast";
import {
	activeSessionsQueryOptions,
	RecentSessionsResponse,
	recentSessionsInfiniteQueryOptions,
} from "../src/lib/api/sessions";
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
	await waitFor(() => {
		expect(result.container.querySelector("a[data-row-main-button]")).toBeTruthy();
	});
	return result;
}

function rowLink(title: string): HTMLElement {
	const link = screen.getByText(title).closest("a[data-row-main-button]");
	if (!(link instanceof HTMLElement)) throw new Error(`no row ${title}`);
	return link;
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

	it("takes row kebabs out of the tab order but keeps them clickable, and draws unread marks as plain status", async () => {
		__unreadStoreTesting.reset();
		syncUnseenFromSummaries(FIXTURE.map(({id}) => ({id, unseen: true})));
		await renderGroups();

		const kebabs = screen.getAllByRole("button", {name: /^More options for /});
		expect({
			kebabs: kebabs.map((kebab) => kebab.getAttribute("tabindex")),
			// Upstream's trailing mark is not interactive; the row menu marks a session read.
			markButtons: screen.queryAllByRole("button", {name: "Click to mark as read"}).length,
			unread: screen.getAllByRole("status").filter((status) => status.textContent === " Unread response").length,
		}).toStrictEqual({kebabs: ["-1", "-1", "-1"], markButtons: 0, unread: 3});

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

async function renderSidebar(path = "/") {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications: []});
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
		terminalWritesEnabled: false,
		terminalHost: "auto",
		shellPaneEnabled: true,
		visibleNavSections: ["projects", "plans"],
		ignoredDirs: ["node_modules"],
	});
	queryClient.setQueryData(
		recentSessionsInfiniteQueryOptions(undefined, DEFAULTS.sessionListPrefs.statusFilter).queryKey,
		{pages: [RecentSessionsResponse.parse({sessions: FIXTURE, nextCursor: null})], pageParams: [null]},
	);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<Sidebar collapsed={false} />
						<Outlet />
					</SettingsProvider>
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
		history: createMemoryHistory({initialEntries: [path]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await waitFor(() => {
		expect(document.querySelector("a[data-row-main-button]")).toBeTruthy();
	});
}

/** An element's label, or the title of the session row whose link it is. */
function name(element: Element | null): string {
	if (element?.matches("button.df-search-field") === true) return "Search field";
	const row = FIXTURE.find(({title}) => element === rowLink(title));
	return row?.title ?? label(element);
}

/** The focused element's label, or the title of the session row whose link holds focus. */
function focused(): string {
	return name(document.activeElement);
}

/** Every element Tab would stop on inside the sidebar body, in DOM order. */
function bodyTabStops(): string[] {
	const body = screen.getByRole("link", {name: "New"}).closest("[data-sidebar-body]");
	if (body === null) throw new Error("no sidebar body");
	return [...body.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex]")]
		.filter(
			(element) =>
				element.tabIndex >= 0 && element.closest("[inert]") === null && !element.hasAttribute("disabled"),
		)
		.map(name);
}

/** Every roving item's tabindex attribute, keyed by label. */
function rovingTabIndexes(): Record<string, string | null> {
	return Object.fromEntries(
		[...document.querySelectorAll("[data-roving-item]")].map((item) => [name(item), item.getAttribute("tabindex")]),
	);
}

/** Presses `key` on the focused element and returns the newly focused element's label. */
function press(key: string, init: {shiftKey?: boolean; metaKey?: boolean} = {}): string {
	fireEvent.keyDown(document.activeElement!, {key, ...init});
	return focused();
}

describe("sidebar body roving focus", () => {
	const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();

	beforeEach(() => {
		installLocalStorage();
		vi.stubGlobal("fetch", async () => new Promise(() => {}));
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		scrollIntoView.mockClear();
		Element.prototype.scrollIntoView = scrollIntoView;
		// jsdom lays nothing out, so every element's offsetParent is null; treat attached elements as rendered.
		Object.defineProperty(HTMLElement.prototype, "offsetParent", {
			configurable: true,
			get(this: HTMLElement) {
				return this.parentElement;
			},
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
	});

	it("roves down from New through the nav rows and More into the session list", async () => {
		await renderSidebar();

		screen.getByRole("link", {name: "New"}).focus();
		expect([
			press("ArrowDown"),
			press("ArrowDown"),
			press("ArrowDown"),
			press("ArrowDown"),
			press("ArrowDown"),
		]).toEqual(["Projects", "Plans", "More navigation items", "Completed", "First row"]);
		expect(scrollIntoView).toHaveBeenLastCalledWith({block: "nearest"});
	});

	it("roves up from the first group toggle to More", async () => {
		await renderSidebar();

		screen.getByRole("button", {name: "Completed"}).focus();
		expect(press("ArrowUp")).toBe("More navigation items");
	});

	it("wraps around both ends and jumps with Home and End", async () => {
		await renderSidebar();

		rowLink("Second row").focus();
		expect({
			end: press("End"),
			wrapDown: press("ArrowDown"),
			down: press("ArrowDown"),
			wrapUp: [press("ArrowUp"), press("ArrowUp")],
			home: (rowLink("First row").focus(), press("Home")),
		}).toStrictEqual({
			end: "Third row",
			wrapDown: "Search field",
			down: "New",
			wrapUp: ["Search field", "Third row"],
			home: "Search field",
		});
	});

	it("roves with Shift held but not with Meta", async () => {
		await renderSidebar();

		rowLink("First row").focus();
		expect([press("ArrowDown", {shiftKey: true}), press("ArrowDown", {metaKey: true})]).toEqual([
			"Second row",
			"Second row",
		]);
	});

	it("roves from a row's kebab to the next row", async () => {
		await renderSidebar();

		screen.getByRole("button", {name: "More options for First row"}).focus();
		expect(press("ArrowDown")).toBe("Second row");
	});

	it("moves along a group header's buttons with ArrowRight and ArrowLeft, clamping at the end", async () => {
		await renderSidebar();

		screen.getByRole("button", {name: "Completed"}).focus();
		expect([
			press("ArrowRight"),
			press("ArrowRight"),
			press("ArrowRight"),
			press("ArrowLeft"),
			press("ArrowDown"),
		]).toEqual(["Group and sort", "New session", "New session", "Group and sort", "First row"]);
	});

	it("moves between a session row's link and its kebab with ArrowRight and ArrowLeft", async () => {
		await renderSidebar();

		rowLink("Second row").focus();
		expect([press("ArrowRight"), press("ArrowLeft"), press("ArrowLeft")]).toEqual([
			"More options for Second row",
			"Second row",
			"Second row",
		]);
	});

	it("leaves ArrowRight alone on a nav row without actions", async () => {
		await renderSidebar();

		const projects = screen.getByRole("link", {name: "Projects"});
		projects.focus();
		const notPrevented = fireEvent.keyDown(projects, {key: "ArrowRight"});
		expect({focused: focused(), notPrevented}).toStrictEqual({focused: "Projects", notPrevented: true});
	});

	it("leaves tabindexes alone until focus first enters the body", async () => {
		await renderSidebar();

		expect([
			screen.getByRole("link", {name: "New"}).getAttribute("tabindex"),
			screen.getByRole("link", {name: "Projects"}).getAttribute("tabindex"),
		]).toEqual([null, null]);
	});

	it("gives the field, the nav rows and the session list one tab stop each", async () => {
		await renderSidebar();

		screen.getByRole("link", {name: "New"}).focus();
		expect({
			stops: bodyTabStops(),
			groupAndSort: screen
				.getAllByRole("button", {name: "Group and sort"})
				.map((button) => button.getAttribute("tabindex")),
		}).toStrictEqual({stops: ["Search field", "New", "Completed"], groupAndSort: ["-1"]});
	});

	it("keeps the last focused nav row as the nav stop after focus moves into the list", async () => {
		await renderSidebar();

		screen.getByRole("link", {name: "New"}).focus();
		press("ArrowDown");
		press("ArrowDown");
		press("ArrowDown");
		rowLink("First row").focus();
		expect(bodyTabStops()).toEqual(["Search field", "More navigation items", "First row"]);
	});

	it("keeps the first item as the tab stop when a row is selected", async () => {
		await renderSidebar("/session/s2");

		expect(rowLink("Second row").dataset["selected"]).toBe("focused");
		screen.getByRole("link", {name: "New"}).focus();
		expect(bodyTabStops()).toEqual(["Search field", "New", "Completed"]);
	});

	it("re-chooses the tab stops when Tab is pressed", async () => {
		await renderSidebar();

		screen.getByRole("link", {name: "New"}).focus();
		screen.getByRole("button", {name: "Completed"}).setAttribute("tabindex", "-1");
		fireEvent.keyDown(document.activeElement!, {key: "Tab"});
		expect(bodyTabStops()).toEqual(["Search field", "New", "Completed"]);
	});

	it("leaves the tab stops alone while rows are selected", async () => {
		await renderSidebar();

		screen.getByRole("link", {name: "New"}).focus();
		fireEvent.click(rowLink("First row"), {metaKey: true});
		const before = rovingTabIndexes();
		rowLink("Second row").focus();
		expect(rovingTabIndexes()).toStrictEqual(before);
	});
});
