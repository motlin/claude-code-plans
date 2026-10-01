// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {DEFAULTS, SettingsProvider} from "../src/components/settings-provider";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {readSidebarState, useSidebarState, writeSidebarState} from "../src/lib/sidebar-store";
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

async function renderExpandedSidebar() {
	writeSidebarState({...readSidebarState(), collapsed: false});
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<PersistedSidebar />
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
	return waitFor(() => screen.getByRole("button", {name: "Hide sidebar"}));
}

function PersistedSidebar({narrowViewport = false}: {narrowViewport?: boolean}) {
	const {collapsed} = useSidebarState();
	return <Sidebar collapsed={collapsed || narrowViewport} narrowViewport={narrowViewport} />;
}

async function renderCollapsedSidebar({narrowViewport = false}: {narrowViewport?: boolean} = {}) {
	writeSidebarState({...readSidebarState(), collapsed: true});
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<PersistedSidebar narrowViewport={narrowViewport} />
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
	return waitFor(() => screen.getByRole("button", {name: "Show sidebar"}));
}

afterEach(cleanup);

beforeEach(() => {
	installLocalStorage();
});

describe("collapsed sidebar peek", () => {
	it("floats a transparent 24px trigger with a 16px icon at 12,12", async () => {
		const trigger = await renderCollapsedSidebar();
		const root = screen.getByTestId("sidebar-collapsed");

		expect({
			root: ["left-3", "top-3"].filter((token) => root.classList.contains(token)),
			trigger: ["size-6", "[&_svg]:size-4", "text-primary"].filter((token) => trigger.classList.contains(token)),
			restingBackground: [...trigger.classList].filter((token) => token.startsWith("bg-")),
		}).toEqual({
			root: ["left-3", "top-3"],
			trigger: ["size-6", "[&_svg]:size-4", "text-primary"],
			restingBackground: [],
		});
	});

	it("puts the expanded Hide sidebar toggle at the same 12,12 spot in secondary ink", async () => {
		const toggle = await renderExpandedSidebar();
		const titlebar = screen.getByTestId("sidebar-titlebar");
		const slot = screen.getByTestId("sidebar-toggle-slot");

		expect({
			inTitlebar: titlebar.contains(toggle),
			titlebarPaddingX: titlebar.classList.contains("px-2"),
			slot: ["w-8", "self-start", "pt-3"].filter((token) => slot.classList.contains(token)),
			toggle: ["size-6", "text-secondary"].filter((token) => toggle.classList.contains(token)),
			primaryInk: toggle.classList.contains("text-primary"),
		}).toEqual({
			inTitlebar: true,
			titlebarPaddingX: true,
			slot: ["w-8", "self-start", "pt-3"],
			toggle: ["size-6", "text-secondary"],
			primaryInk: false,
		});
	});

	it("shows the popover while the trigger is hovered and hides it after leaving", async () => {
		const trigger = await renderCollapsedSidebar();
		const root = screen.getByTestId("sidebar-collapsed");
		const peek = screen.getByTestId("sidebar-peek");

		expect({
			hovering: root.hasAttribute("data-hovering"),
			ariaHidden: peek.getAttribute("aria-hidden"),
			inert: peek.hasAttribute("inert"),
		}).toEqual({hovering: false, ariaHidden: "true", inert: true});

		act(() => {
			fireEvent.pointerEnter(trigger);
		});
		expect({
			hovering: root.hasAttribute("data-hovering"),
			ariaHidden: peek.getAttribute("aria-hidden"),
			inert: peek.hasAttribute("inert"),
			nav: screen.getByRole("navigation", {name: "Sidebar"}) === peek,
		}).toEqual({hovering: true, ariaHidden: null, inert: false, nav: true});

		act(() => {
			fireEvent.pointerLeave(trigger);
		});
		expect({
			hovering: root.hasAttribute("data-hovering"),
			ariaHidden: peek.getAttribute("aria-hidden"),
		}).toEqual({hovering: false, ariaHidden: "true"});
	});

	it("keeps the peek open while the pointer moves across the bridge into the popover", async () => {
		const trigger = await renderCollapsedSidebar();
		const root = screen.getByTestId("sidebar-collapsed");
		const bridge = screen.getByTestId("sidebar-peek-bridge");
		const peek = screen.getByTestId("sidebar-peek");

		act(() => {
			fireEvent.pointerEnter(trigger);
		});
		act(() => {
			fireEvent.pointerOut(trigger, {relatedTarget: bridge});
			fireEvent.pointerOver(bridge, {relatedTarget: trigger});
		});
		act(() => {
			fireEvent.pointerOut(bridge, {relatedTarget: peek});
			fireEvent.pointerOver(peek, {relatedTarget: bridge});
		});
		expect(root.hasAttribute("data-hovering")).toBe(true);

		act(() => {
			fireEvent.pointerLeave(peek);
		});
		expect(root.hasAttribute("data-hovering")).toBe(false);
	});

	it("renders the peek as a full-height panel holding the wordmark and no Search button", async () => {
		await renderCollapsedSidebar();
		const peek = screen.getByTestId("sidebar-peek");
		const classes = [...peek.classList];

		expect({
			fullHeight: ["fixed", "inset-y-0", "left-0", "h-dvh", "w-[288px]", "rounded-none", "pt-12"].filter(
				(token) => classes.includes(token),
			),
			card: classes.filter((token) => token === "max-h-[70vh]" || token === "rounded-card"),
			wordmark: within(peek).getByRole("link", {name: "Claude Code Browser", hidden: true}).getAttribute("href"),
			search: within(peek).queryByRole("button", {name: "Search", hidden: true}),
		}).toEqual({
			fullHeight: ["fixed", "inset-y-0", "left-0", "h-dvh", "w-[288px]", "rounded-none", "pt-12"],
			card: [],
			wordmark: "/",
			search: null,
		});
	});

	it("points the trigger at the peek with aria-controls and flips aria-expanded on hover", async () => {
		const trigger = await renderCollapsedSidebar();
		const peek = screen.getByTestId("sidebar-peek");

		expect({
			controls: trigger.getAttribute("aria-controls"),
			expanded: trigger.getAttribute("aria-expanded"),
		}).toEqual({controls: peek.id, expanded: "false"});
		expect(peek.id).not.toBe("");

		act(() => {
			fireEvent.pointerEnter(trigger);
		});
		expect(trigger.getAttribute("aria-expanded")).toBe("true");

		act(() => {
			fireEvent.pointerLeave(trigger);
		});
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});

	it("shows the Show sidebar tooltip on the forced-collapse trigger", async () => {
		const trigger = await renderCollapsedSidebar({narrowViewport: true});

		act(() => {
			trigger.focus();
		});

		const tooltip = await screen.findByRole("tooltip");
		expect({
			text: tooltip.textContent?.startsWith("Show sidebar"),
			describedBy: trigger.getAttribute("aria-describedby"),
		}).toEqual({text: true, describedBy: tooltip.id});
	});

	it("keeps the forced-collapse peek open on tap until an outside press", async () => {
		const trigger = await renderCollapsedSidebar({narrowViewport: true});
		const root = screen.getByTestId("sidebar-collapsed");

		act(() => {
			fireEvent.click(trigger);
		});
		expect({hovering: root.hasAttribute("data-hovering"), collapsed: readSidebarState().collapsed}).toEqual({
			hovering: true,
			collapsed: true,
		});

		act(() => {
			fireEvent.pointerDown(document.body);
		});
		expect(root.hasAttribute("data-hovering")).toBe(false);
	});

	it("expands and persists when Enter is pressed on the focused trigger", async () => {
		const trigger = await renderCollapsedSidebar();
		trigger.focus();

		act(() => {
			fireEvent.keyDown(trigger, {key: "Enter", code: "Enter"});
		});

		expect(readSidebarState().collapsed).toBe(false);
		expect(screen.getByRole("button", {name: "Hide sidebar"}).tagName).toBe("BUTTON");
		expect(screen.queryByTestId("sidebar-collapsed")).toBe(null);
	});
});
