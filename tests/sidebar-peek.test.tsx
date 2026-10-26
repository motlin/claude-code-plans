// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
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
		terminalWritesEnabled: false,
		terminalHost: "auto",
		shellPaneEnabled: true,
		visibleNavSections: NAV_SECTIONS.filter((section) => section !== "herdr"),
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

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

/** Fake only the timeout pair after render, so the router's async load still resolves. */
function fakeTimeouts() {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
}

/** Run the peek's 180ms close grace (upstream's `fu` → `RA`). */
function runCloseGrace() {
	act(() => {
		vi.advanceTimersByTime(180);
	});
}

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
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");
		const peek = screen.getByTestId("sidebar-peek");

		expect({
			hovering: root.hasAttribute("data-hovering"),
			ariaHidden: peek.getAttribute("aria-hidden"),
			inert: peek.hasAttribute("inert"),
		}).toEqual({hovering: false, ariaHidden: "true", inert: true});

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		expect({
			hovering: root.hasAttribute("data-hovering"),
			ariaHidden: peek.getAttribute("aria-hidden"),
			inert: peek.hasAttribute("inert"),
			nav: screen.getByRole("navigation", {name: "Sidebar"}) === peek,
		}).toEqual({hovering: true, ariaHidden: null, inert: false, nav: true});

		act(() => {
			fireEvent.pointerLeave(trigger, {pointerType: "mouse"});
		});
		runCloseGrace();
		expect({
			hovering: root.hasAttribute("data-hovering"),
			ariaHidden: peek.getAttribute("aria-hidden"),
		}).toEqual({hovering: false, ariaHidden: "true"});
	});

	it("keeps the peek open while the pointer moves across the bridge into the popover", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");
		const bridge = screen.getByTestId("sidebar-peek-bridge");
		const peek = screen.getByTestId("sidebar-peek");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
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
			fireEvent.pointerLeave(peek, {pointerType: "mouse"});
		});
		runCloseGrace();
		expect(root.hasAttribute("data-hovering")).toBe(false);
	});

	it("renders the peek as a full-height panel holding the wordmark and the Search field, but no footer Search icon", async () => {
		await renderCollapsedSidebar();
		const peek = screen.getByTestId("sidebar-peek");
		const classes = [...peek.classList];

		expect({
			fullHeight: ["fixed", "inset-y-0", "left-0", "h-dvh", "w-[288px]", "rounded-none", "pt-12"].filter(
				(token) => classes.includes(token),
			),
			card: classes.filter((token) => token === "max-h-[70vh]" || token === "rounded-card"),
			wordmark: within(peek).getByRole("link", {name: "Claude Code Browser", hidden: true}).getAttribute("href"),
			footerSearch: within(within(peek).getByTestId("sidebar-footer")).queryByRole("button", {
				name: "Search",
				hidden: true,
			}),
			fields: within(peek)
				.getAllByRole("button", {name: "Search", hidden: true})
				.map((button) => button.classList.contains("df-search-field")),
		}).toEqual({
			fullHeight: ["fixed", "inset-y-0", "left-0", "h-dvh", "w-[288px]", "rounded-none", "pt-12"],
			card: [],
			wordmark: "/",
			footerSearch: null,
			fields: [true],
		});
	});

	it("points the trigger at the peek with aria-controls and flips aria-expanded on hover", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const peek = screen.getByTestId("sidebar-peek");

		expect({
			controls: trigger.getAttribute("aria-controls"),
			expanded: trigger.getAttribute("aria-expanded"),
		}).toEqual({controls: peek.id, expanded: "false"});
		expect(peek.id).not.toBe("");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		expect(trigger.getAttribute("aria-expanded")).toBe("true");

		act(() => {
			fireEvent.pointerLeave(trigger, {pointerType: "mouse"});
		});
		runCloseGrace();
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});

	it("shows the Show sidebar tooltip on the forced-collapse trigger", async () => {
		const trigger = await renderCollapsedSidebar({narrowViewport: true});

		act(() => {
			trigger.focus();
		});

		const tooltip = await screen.findByRole("tooltip");
		expect({
			text: tooltip.textContent.startsWith("Show sidebar"),
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

describe("collapsed sidebar peek close grace", () => {
	it("holds the peek for 180ms after the pointer leaves, then closes", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		act(() => {
			fireEvent.pointerLeave(root, {pointerType: "mouse"});
		});
		act(() => {
			vi.advanceTimersByTime(179);
		});
		const at179 = root.hasAttribute("data-hovering");
		act(() => {
			vi.advanceTimersByTime(1);
		});

		expect({at179, at180: root.hasAttribute("data-hovering")}).toStrictEqual({at179: true, at180: false});
	});

	it("cancels the close when the pointer comes back within the grace", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		act(() => {
			fireEvent.pointerLeave(root, {pointerType: "mouse"});
		});
		act(() => {
			vi.advanceTimersByTime(100);
		});
		act(() => {
			fireEvent.pointerEnter(root, {pointerType: "mouse"});
		});
		act(() => {
			vi.advanceTimersByTime(400);
		});

		expect(root.hasAttribute("data-hovering")).toBe(true);
	});

	it("stays open while a text field inside the peek has focus and closes 180ms after it blurs", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");
		const peek = screen.getByTestId("sidebar-peek");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		const field = document.createElement("input");
		field.type = "text";
		peek.append(field);
		act(() => {
			field.focus();
			fireEvent.pointerLeave(root, {pointerType: "mouse"});
		});
		act(() => {
			vi.advanceTimersByTime(400);
		});
		const whileFocused = root.hasAttribute("data-hovering");

		act(() => {
			field.blur();
		});
		act(() => {
			vi.advanceTimersByTime(180);
		});

		expect({whileFocused, afterBlur: root.hasAttribute("data-hovering")}).toStrictEqual({
			whileFocused: true,
			afterBlur: false,
		});
		field.remove();
	});

	it("stays open while a menu opened from the peek is open", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");
		const peek = screen.getByTestId("sidebar-peek");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		const more = within(peek).getByRole("button", {name: "More navigation items"});
		act(() => {
			fireEvent.click(more);
		});
		const menuOpened = more.getAttribute("aria-expanded");
		act(() => {
			fireEvent.pointerLeave(root, {pointerType: "mouse"});
		});
		act(() => {
			vi.advanceTimersByTime(400);
		});

		expect({menuOpened, whileMenuOpen: root.hasAttribute("data-hovering")}).toStrictEqual({
			menuOpened: "true",
			whileMenuOpen: true,
		});
	});

	it("ignores touch and pen hovers", async () => {
		const trigger = await renderCollapsedSidebar();
		const root = screen.getByTestId("sidebar-collapsed");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "touch"});
			fireEvent.pointerEnter(root, {pointerType: "pen"});
		});

		expect(root.hasAttribute("data-hovering")).toBe(false);
	});
});

describe("collapsed sidebar peek after Hide sidebar", () => {
	it("suppresses the peek and the trigger tooltip after a mouse click on Hide until the pointer leaves, and focuses Show sidebar", async () => {
		const hide = await renderExpandedSidebar();
		hide.focus();

		act(() => {
			fireEvent.click(hide, {detail: 1});
		});
		const trigger = screen.getByRole("button", {name: "Show sidebar"});
		const root = screen.getByTestId("sidebar-collapsed");
		act(() => {
			fireEvent.pointerEnter(root, {pointerType: "mouse"});
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 400);
		});
		const suppressed = {
			collapsed: readSidebarState().collapsed,
			hovering: root.hasAttribute("data-hovering"),
			focused: document.activeElement === trigger,
			tooltip: screen.queryByRole("tooltip"),
		};

		act(() => {
			fireEvent.pointerLeave(root, {pointerType: "mouse"});
			fireEvent.pointerEnter(root, {pointerType: "mouse"});
		});

		expect({suppressed, reentered: root.hasAttribute("data-hovering")}).toStrictEqual({
			suppressed: {collapsed: true, hovering: false, focused: true, tooltip: null},
			reentered: true,
		});
	});

	it("focuses Show sidebar when React commits the toggle on its own schedule, outside act", async () => {
		const hide = await renderExpandedSidebar();
		hide.focus();
		const actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
		try {
			hide.click();
			await waitFor(() => screen.getByRole("button", {name: "Show sidebar"}));
		} finally {
			Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
		}

		expect(document.activeElement === screen.getByRole("button", {name: "Show sidebar"})).toBe(true);
	});

	it("does not suppress the peek after a keyboard Hide, but still focuses Show sidebar", async () => {
		const hide = await renderExpandedSidebar();
		hide.focus();

		act(() => {
			fireEvent.click(hide, {detail: 0});
		});
		const root = screen.getByTestId("sidebar-collapsed");
		act(() => {
			fireEvent.pointerEnter(root, {pointerType: "mouse"});
		});

		expect({
			hovering: root.hasAttribute("data-hovering"),
			focused: document.activeElement === screen.getByRole("button", {name: "Show sidebar"}),
		}).toStrictEqual({hovering: true, focused: true});
	});

	it("focuses Hide sidebar after the collapsed trigger expands the sidebar", async () => {
		const trigger = await renderCollapsedSidebar();
		trigger.focus();

		act(() => {
			fireEvent.click(trigger, {detail: 1});
		});

		expect({
			collapsed: readSidebarState().collapsed,
			focused: document.activeElement === screen.getByRole("button", {name: "Hide sidebar"}),
		}).toStrictEqual({collapsed: false, focused: true});
	});

	it("leaves focus alone when the sidebar is toggled by the shortcut instead of a button", async () => {
		await renderExpandedSidebar();
		const outside = document.createElement("button");
		document.body.append(outside);
		outside.focus();

		act(() => {
			writeSidebarState({...readSidebarState(), collapsed: true});
		});

		expect(document.activeElement === outside).toBe(true);
		outside.remove();
	});
});

describe("collapsed sidebar peek motion", () => {
	it("nudges the resting peek 4px instead of sliding the full width", async () => {
		await renderCollapsedSidebar();
		const peek = screen.getByTestId("sidebar-peek");

		expect({
			nudge: peek.classList.contains("-translate-x-1"),
			fullSlide: peek.classList.contains("-translate-x-full"),
			open: ["group-data-[hovering]/peek:translate-x-0", "group-data-[hovering]/peek:opacity-100"].filter(
				(token) => peek.classList.contains(token),
			),
		}).toStrictEqual({
			nudge: true,
			fullSlide: false,
			open: ["group-data-[hovering]/peek:translate-x-0", "group-data-[hovering]/peek:opacity-100"],
		});
	});

	it("marks the root data-peeked on the first open and keeps it after the peek closes", async () => {
		const trigger = await renderCollapsedSidebar();
		fakeTimeouts();
		const root = screen.getByTestId("sidebar-collapsed");
		const beforeHover = root.hasAttribute("data-peeked");

		act(() => {
			fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		});
		const whileOpen = root.hasAttribute("data-peeked");
		act(() => {
			fireEvent.pointerLeave(root, {pointerType: "mouse"});
		});
		runCloseGrace();

		expect({
			beforeHover,
			whileOpen,
			afterClose: root.hasAttribute("data-peeked"),
			hovering: root.hasAttribute("data-hovering"),
		}).toStrictEqual({beforeHover: false, whileOpen: true, afterClose: true, hovering: false});
	});

	it("transitions only once peeked, and keeps the opacity fade without the nudge under reduced motion", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const rule = (selector: string, from = 0) => {
			const start = styles.indexOf(`${selector} {`, from);
			return start === -1 ? null : styles.slice(start, styles.indexOf("}", start) + 1).replace(/\s+/g, " ");
		};
		const reducedMotion = styles.indexOf(
			"@media (prefers-reduced-motion: reduce) {",
			styles.indexOf("[data-peeked] .sidebar-peek-motion"),
		);

		expect({
			resting: rule("\n.sidebar-peek-motion"),
			peeked: rule("[data-peeked] .sidebar-peek-motion"),
			reducedMotion: rule(".sidebar-peek-motion", reducedMotion),
		}).toStrictEqual({
			resting: null,
			peeked: "[data-peeked] .sidebar-peek-motion { transition: opacity 0.14s ease, translate 0.18s cubic-bezier(0.32, 0.72, 0, 1); }",
			reducedMotion: ".sidebar-peek-motion { translate: none; }",
		});
	});
});
