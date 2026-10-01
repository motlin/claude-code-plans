// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {DEFAULTS, SettingsProvider} from "../src/components/settings-provider";
import {NavScroll} from "../src/components/sidebar/nav-scroll";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {readSidebarState} from "../src/lib/sidebar-store";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {installLocalStorage} from "./fake-storage";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {ToastProvider} from "../src/components/toast";

function seedQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications: []});
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
		herdrWritesEnabled: false,
		shellPaneEnabled: true,
		visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr" && section !== "tmux"),
		ignoredDirs: ["node_modules"],
	});
	return queryClient;
}

async function renderSidebar() {
	const queryClient = seedQueryClient();
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
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
}

afterEach(cleanup);

beforeEach(() => {
	installLocalStorage();
});

describe("sidebar header", () => {
	it("puts the Hide sidebar toggle first, followed by the wordmark linking home", async () => {
		await renderSidebar();

		const toggle = await waitFor(() => screen.getByRole("button", {name: "Hide sidebar"}));
		const header = screen.getByTestId("sidebar-titlebar");
		const wordmark = screen.getByRole("link", {name: "Claude Code Browser"});

		expect(header.firstElementChild?.contains(toggle)).toBe(true);
		expect(header.children[1]?.contains(wordmark)).toBe(true);
		expect({text: wordmark.textContent, href: wordmark.getAttribute("href")}).toEqual({
			text: "Claude Code Browser",
			href: "/",
		});
	});
});

describe("sidebar resize handle", () => {
	it("persists the width to the sidebar store and exposes it as --sidebar-width", async () => {
		await renderSidebar();
		const handle = await waitFor(() => screen.getByRole("separator", {name: "Resize sidebar"}));
		const nav = screen.getByRole("navigation", {name: "Sidebar"});

		expect({
			now: handle.getAttribute("aria-valuenow"),
			cssVar: nav.style.getPropertyValue("--sidebar-width"),
			insideNav: nav.contains(handle),
		}).toStrictEqual({now: "288", cssVar: "288px", insideNav: true});

		fireEvent.keyDown(handle, {key: "ArrowRight"});

		expect({
			now: handle.getAttribute("aria-valuenow"),
			cssVar: nav.style.getPropertyValue("--sidebar-width"),
			stored: readSidebarState().width,
		}).toStrictEqual({now: "296", cssVar: "296px", stored: 296});
	});
});

describe("nav scroll", () => {
	it("keeps a stable thin scrollbar gutter like upstream", () => {
		render(
			<NavScroll>
				<div>content</div>
			</NavScroll>,
		);

		const classes = screen.getByTestId("nav-scroll").className.split(" ");
		expect(classes.filter((token) => token.startsWith("[scrollbar-"))).toStrictEqual([
			"[scrollbar-gutter:stable]",
			"[scrollbar-width:thin]",
		]);
	});

	it("sets data-scrolled only while scrolled away from the top", () => {
		render(
			<NavScroll>
				<div>content</div>
			</NavScroll>,
		);
		const scroller = screen.getByTestId("nav-scroll");
		expect(scroller.hasAttribute("data-scrolled")).toBe(false);

		act(() => {
			scroller.scrollTop = 40;
			fireEvent.scroll(scroller);
		});
		expect(scroller.hasAttribute("data-scrolled")).toBe(true);

		act(() => {
			scroller.scrollTop = 0;
			fireEvent.scroll(scroller);
		});
		expect(scroller.hasAttribute("data-scrolled")).toBe(false);
	});
});
