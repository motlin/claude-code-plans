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
import {DEFAULTS, SettingsProvider} from "../src/components/settings-provider";
import {useActiveSection} from "../src/components/sidebar/hooks";
import {navItems} from "../src/components/sidebar/navigation";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {
	activeSessionsQueryOptions,
	recentSessionsInfiniteQueryOptions,
	RecentSessionsResponse,
} from "../src/lib/api/sessions";
import {invalidateSessionIdentities} from "../src/lib/api/session-identity";
import {localAccountQueryOptions} from "../src/lib/api/local-account";
import {installLocalStorage} from "./fake-storage";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {redirectLegacyPlugins} from "../src/routes/plugins";
import {ToastProvider} from "../src/components/toast";
import {onHomeComposerFocusRequest} from "../src/lib/home-composer-focus";
import {plansQueryOptions} from "../src/lib/api/plans";

function seedQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {
		approvals: [
			{
				sessionId: "session-test-200",
				projectId: "project-test-200",
				projectName: "project-test-200",
				toolName: "ExitPlanMode",
				toolUseId: "tool-use-test-200",
				blockedSince: "2026-01-01T00:00:00.000Z",
				planFilename: null,
				questionPreview: null,
				questionOptions: [],
			},
		],
	});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications: []});
	queryClient.setQueryData(plansQueryOptions().queryKey, [
		{
			filename: "plan-test-alpha.md",
			title: "Plan test alpha",
			mtime: "2026-01-01T00:00:00.000Z",
			projects: [{projectId: "project-test-alpha", projectName: "project-test-alpha"}],
		},
		{
			filename: "plan-test-beta.md",
			title: "Plan test beta",
			mtime: "2026-01-01T00:00:00.000Z",
			projects: [{projectId: "project-test-beta", projectName: "project-test-beta"}],
		},
	]);
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
		herdrWritesEnabled: false,
		shellPaneEnabled: true,
		visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr" && section !== "tmux"),
		ignoredDirs: ["node_modules"],
	});
	return queryClient;
}

async function renderSidebarAt(path: string, queryClient = seedQueryClient()) {
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
	const pathname = path.split(/[?#]/)[0]!;
	const pageRoutes =
		pathname === "/"
			? []
			: [
					createRoute({
						getParentRoute: () => rootRoute,
						path: pathname.startsWith("/session/") ? "/session/$id" : pathname,
					}),
				];
	const homeRoute = createRoute({getParentRoute: () => rootRoute, path: "/"});
	const router = createRouter({
		routeTree: rootRoute.addChildren([...pageRoutes, homeRoute]),
		history: createMemoryHistory({initialEntries: [path]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

beforeEach(() => {
	installLocalStorage();
});

describe("sidebar navigation", () => {
	it("selects the local session for an alias and clears selection when that alias becomes ambiguous", async () => {
		vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2000, 0, 1));
		const queryClient = seedQueryClient();
		queryClient.setQueryData(localAccountQueryOptions.queryKey, {name: "Alice", firstName: "Alice", initial: "A"});
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
			pages: [
				RecentSessionsResponse.parse({
					sessions: [
						{
							id: "session-alice",
							title: "Example Alice session",
							mtime: "2000-01-01T00:00:00.000Z",
							created: "2000-01-01T00:00:00.000Z",
							project: "example-project",
							projectName: "Example project",
							messageCount: 1,
							archived: false,
							state: "idle",
							bucket: "done",
							liveAgentCount: 0,
							unseen: false,
							blockedSince: null,
						},
					],
					nextCursor: null,
				}),
			],
			pageParams: [null],
		});
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json({sessionId: "session-alice"}))
			.mockResolvedValue(Response.json({}, {status: 409}));
		vi.stubGlobal("fetch", fetch);
		await renderSidebarAt("/session/session_alice_100", queryClient);
		const title = await screen.findByText("Example Alice session");
		const row = title.closest("a[data-row-main-button]");
		if (row === null) throw new Error("Example session row is missing");
		await waitFor(() => expect(row.getAttribute("data-selected")).toBe("focused"));
		await act(() => invalidateSessionIdentities(queryClient));
		await waitFor(() => expect(row.getAttribute("data-selected")).toBe(null));
		expect(fetch.mock.calls.map(([url]) => url)).toStrictEqual([
			"/api/sessions/session_alice_100/identity",
			"/api/sessions/session_alice_100/identity",
		]);
	});
	it("links to each top-level section", () => {
		expect(navItems.map(({label, to}) => ({label, to}))).toStrictEqual([
			{label: "Artifacts", to: "/artifacts"},
			{label: "Routines", to: "/routines"},
			{label: "Background jobs", to: "/jobs"},
			{label: "Active", to: "/active"},
			{label: "Herdr", to: "/herdr"},
			{label: "Tmux Windows", to: "/tmux"},
			{label: "Approvals", to: "/approvals"},
			{label: "Notifications", to: "/notifications"},
			{label: "Tasks", to: "/tasks"},
			{label: "Projects", to: "/projects"},
			{label: "Plans", to: "/plans"},
			{label: "Memories", to: "/memories"},
			{label: "Sessions", to: "/sessions"},
			{label: "Customize", to: "/customize"},
		]);
	});

	it("drops Settings, Claude Config and Setup, which live in the account menu", () => {
		expect(
			navItems.filter(
				(item) =>
					["Settings", "Claude Config", "Setup"].includes(item.label) ||
					["/settings", "/settings/edit", "/setup"].includes(item.to),
			),
		).toStrictEqual([]);
	});

	it("replaces the Plugins row with a Customize row", () => {
		expect({
			customize: navItems.filter((item) => item.section === "customize").map(({label, to}) => ({label, to})),
			plugins: navItems.filter((item) => item.label === "Plugins" || item.to === "/plugins"),
		}).toStrictEqual({customize: [{label: "Customize", to: "/customize"}], plugins: []});
	});

	it("activates the Artifacts section on the gallery", () => {
		expect(
			useActiveSection([{fullPath: "/artifacts", params: {}}] as unknown as Parameters<
				typeof useActiveSection
			>[0]),
		).toStrictEqual({section: "artifacts", activeItemId: null});
	});

	it("activates the Routines section on the Routines page", () => {
		expect(
			useActiveSection([{fullPath: "/routines", params: {}}] as unknown as Parameters<
				typeof useActiveSection
			>[0]),
		).toStrictEqual({section: "routines", activeItemId: null});
	});

	it("activates the Background jobs section on the Background jobs page", () => {
		expect(
			useActiveSection([{fullPath: "/jobs", params: {}}] as unknown as Parameters<typeof useActiveSection>[0]),
		).toStrictEqual({section: "jobs", activeItemId: null});
	});

	it("activates the Customize section on Customize and legacy plugin routes", () => {
		const sectionAt = (fullPath: string, params: Record<string, string> = {}) =>
			useActiveSection([{fullPath, params}] as unknown as Parameters<typeof useActiveSection>[0]);

		expect([
			sectionAt("/customize/skills"),
			sectionAt("/customize/plugins/id/$pluginId", {pluginId: "tools@market"}),
			sectionAt("/plugins"),
			sectionAt("/command/$source/$filename"),
		]).toStrictEqual([
			{section: "customize", activeItemId: null},
			{section: "customize", activeItemId: null},
			{section: "customize", activeItemId: null},
			{section: "customize", activeItemId: null},
		]);
	});

	it("redirects the old Plugins nav link into Customize", async () => {
		const rootRoute = createRootRoute({component: Outlet});
		const router = createRouter({
			routeTree: rootRoute.addChildren([
				createRoute({
					getParentRoute: () => rootRoute,
					path: "/plugins",
					beforeLoad: redirectLegacyPlugins,
				}),
				createRoute({getParentRoute: () => rootRoute, path: "/customize/plugins"}),
			]),
			history: createMemoryHistory({initialEntries: ["/plugins"]}),
		});
		await router.load();

		expect(router.state.location.pathname).toBe("/customize/plugins");
	});

	it("activates no nav section on the Claude Config editor or Setup pages", () => {
		const sectionAt = (fullPath: string) =>
			useActiveSection([{fullPath, params: {}}] as unknown as Parameters<typeof useActiveSection>[0]);

		expect([sectionAt("/settings/edit"), sectionAt("/setup")]).toStrictEqual([
			{section: null, activeItemId: null},
			{section: null, activeItemId: null},
		]);
	});

	it("activates the tmux section on the tmux route", () => {
		const matches = [{fullPath: "/tmux", params: {}}] as unknown as Parameters<typeof useActiveSection>[0];

		expect(useActiveSection(matches)).toStrictEqual({section: "tmux", activeItemId: null});
	});

	it("activates the Herdr section and terminal on a live terminal route", () => {
		const matches = [
			{fullPath: "/herdr/terminal/$sessionId", params: {sessionId: "session-test-100"}},
		] as unknown as Parameters<typeof useActiveSection>[0];

		expect(useActiveSection(matches)).toStrictEqual({
			section: "herdr",
			activeItemId: "session-test-100",
		});
	});
});

describe("sidebar nav rows", () => {
	function navRows(): HTMLElement[] {
		const footer = screen.getByTestId("sidebar-footer");
		return screen
			.getAllByRole("link")
			.filter((link) => navItems.some((item) => item.to === link.getAttribute("href")))
			.filter((link) => !footer.contains(link));
	}

	it("uses the upstream row recipe on every nav link", async () => {
		await renderSidebarAt("/tasks");
		await waitFor(() => screen.getByRole("link", {name: "Tasks"}));

		const rows = navRows();
		expect(rows.length).toBeGreaterThan(0);
		expect(
			rows.map((row) => ({
				href: row.getAttribute("href"),
				height: row.classList.contains("h-[var(--sb-row-h)]"),
				radius: row.classList.contains("rounded-[var(--sb-radius)]"),
				leadingSlot: row.querySelector(":scope > .df-leading-slot > svg") !== null,
			})),
		).toStrictEqual(
			rows.map((row) => ({
				href: row.getAttribute("href"),
				height: true,
				radius: true,
				leadingSlot: true,
			})),
		);
	});

	it("marks only the active row as focused", async () => {
		await renderSidebarAt("/tasks");
		await waitFor(() => screen.getByRole("link", {name: "Tasks"}));

		expect(
			navRows()
				.filter((row) => row.hasAttribute("data-selected"))
				.map((row) => ({
					href: row.getAttribute("href"),
					selected: row.getAttribute("data-selected"),
				})),
		).toStrictEqual([{href: "/tasks", selected: "focused"}]);
	});

	it("has no Expand or Collapse chevrons on nav rows", async () => {
		await renderSidebarAt("/plans");
		await waitFor(() => screen.getByRole("link", {name: "Plans"}));

		expect(
			screen
				.queryAllByRole("button")
				.map((button) => button.getAttribute("title") ?? button.textContent ?? "")
				.filter((name) => /^(Expand|Collapse) /.test(name)),
		).toStrictEqual([]);
	});

	it.each(["/plans", "/plans/some-plan", "/plan/$filename"])("selects the Plans row at %s", async (path) => {
		await renderSidebarAt(path);
		await waitFor(() => screen.getByRole("link", {name: "Plans"}));

		expect(
			navRows()
				.filter((row) => row.hasAttribute("data-selected"))
				.map((row) => ({href: row.getAttribute("href"), selected: row.getAttribute("data-selected")})),
		).toStrictEqual([{href: "/plans", selected: "focused"}]);
	});

	it("selects the Memories row on a memory detail route", async () => {
		await renderSidebarAt("/memory/$project/$filename");
		await waitFor(() => screen.getByRole("link", {name: "Memories"}));

		expect(
			navRows()
				.filter((row) => row.hasAttribute("data-selected"))
				.map((row) => ({href: row.getAttribute("href"), selected: row.getAttribute("data-selected")})),
		).toStrictEqual([{href: "/memories", selected: "focused"}]);
	});

	it("renders no plan groups or plan links in the sidebar", async () => {
		await renderSidebarAt("/plans");
		await waitFor(() => screen.getByRole("link", {name: "Plans"}));

		const sidebar = screen.getByRole("navigation", {name: "Sidebar"});
		expect({
			groupToggles: within(sidebar).queryAllByRole("button", {name: /project-test-(alpha|beta)/}).length,
			planLinks: within(sidebar).queryAllByRole("link", {name: /Plan test/}).length,
		}).toStrictEqual({groupToggles: 0, planLinks: 0});
	});

	it("renders count badges inside the trailing slot", async () => {
		await renderSidebarAt("/tasks");
		const approvals = await waitFor(() => screen.getByRole("link", {name: /Approvals/}));

		const tail = approvals.querySelector(":scope > .df-tail-mark");
		expect({
			text: tail?.textContent,
			badgeTitle: tail ? within(tail as HTMLElement).getByTitle("1 awaiting approval").textContent : null,
		}).toStrictEqual({text: "1", badgeTitle: "1"});
	});
});

describe("sidebar New row", () => {
	function navLinks(): HTMLElement[] {
		const titlebar = screen.getByTestId("sidebar-titlebar");
		const footer = screen.getByTestId("sidebar-footer");
		return screen.getAllByRole("link").filter((link) => !titlebar.contains(link) && !footer.contains(link));
	}

	it.each([
		{path: "/", selected: "focused", current: "page"},
		{path: "/?filter=alice#settings/general", selected: "focused", current: "page"},
		{path: "/tasks", selected: null, current: null},
		{path: "/session/session-alice-100", selected: null, current: null},
	])("selects New only on the home pathname at $path", async ({path, selected, current}) => {
		await renderSidebarAt(path);
		const newRow = navLinks()[0];

		expect({
			href: newRow?.getAttribute("href"),
			selected: newRow?.getAttribute("data-selected"),
			current: newRow?.getAttribute("aria-current"),
		}).toStrictEqual({href: "/", selected, current});
	});

	it("is the first nav link, points home and reveals ⇧⌘O on hover", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		await renderSidebarAt("/tasks");
		await waitFor(() => screen.getByRole("link", {name: "Tasks"}));

		const first = navLinks()[0];
		const shortcut = first?.querySelector('[data-cds="Shortcut"]');
		expect({
			name: first?.textContent,
			href: first?.getAttribute("href"),
			ariaKeyShortcuts: first?.getAttribute("aria-keyshortcuts"),
			keycaps: [...(shortcut?.querySelectorAll('kbd > [aria-hidden="true"]') ?? [])].map(
				(cap) => cap.textContent,
			),
			hiddenUntilHover: ["opacity-0", "group-hover:opacity-100"].every((name) =>
				shortcut?.parentElement?.classList.contains(name),
			),
		}).toStrictEqual({
			name: "New⇧Shift⌘CommandO",
			href: "/",
			ariaKeyShortcuts: "Shift+Meta+o",
			keycaps: ["⇧", "⌘"],
			hiddenUntilHover: true,
		});
	});

	it("stays outside the scrolling list", async () => {
		await renderSidebarAt("/tasks");
		await waitFor(() => screen.getByRole("link", {name: "Tasks"}));

		const newRow = navLinks()[0];
		expect({
			text: newRow?.textContent?.startsWith("New"),
			inScroll: screen.getByTestId("nav-scroll").contains(newRow ?? null),
		}).toStrictEqual({text: true, inScroll: false});
	});

	it("navigates home and focuses the home composer, like ⇧⌘O", async () => {
		const focusRequests: string[] = [];
		const unsubscribe = onHomeComposerFocusRequest(() => focusRequests.push("focus"));
		try {
			const router = await renderSidebarAt("/tasks");
			await waitFor(() => screen.getByRole("link", {name: "Tasks"}));

			fireEvent.click(navLinks()[0] as HTMLElement);

			await waitFor(() => expect(focusRequests).toStrictEqual(["focus"]));
			expect(router.state.location.pathname).toBe("/");
		} finally {
			unsubscribe();
		}
	});
});
