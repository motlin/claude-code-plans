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
import {AppFrame} from "../src/components/app-frame";
import {useDensity} from "../src/components/ui/density";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {ToastProvider} from "../src/components/toast";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {readSidebarState, SIDEBAR_STORAGE_KEY, useSidebarState, writeSidebarState} from "../src/lib/sidebar-store";
import {COARSE_POINTER_QUERY, NARROW_VIEWPORT_QUERY, PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";
import {readFileSync} from "node:fs";
import {installLocalStorage} from "./fake-storage";

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

function mockViewport(width: number, {coarse = false}: {coarse?: boolean} = {}) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches:
				query === PHONE_SHEET_QUERY
					? width < 640
					: query === NARROW_VIEWPORT_QUERY
						? width < 768
						: query === COARSE_POINTER_QUERY && coarse,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

function PaletteProbe() {
	const palette = useCommandPalette();
	return (
		<div data-testid="palette-probe">
			{palette.open ? "open" : "closed"}:{palette.entrypoint}
		</div>
	);
}

function DensityProbe() {
	return <span data-testid="density-probe">{useDensity()}</span>;
}

function PersistedFrame() {
	const {collapsed} = useSidebarState();
	return (
		<AppFrame collapsed={collapsed}>
			<Outlet />
		</AppFrame>
	);
}

async function renderFrame() {
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<PersistedFrame />
						<PaletteProbe />
					</SettingsProvider>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<>
				<p>Home page</p>
				<DensityProbe />
			</>
		),
	});
	const otherRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/plans",
		component: () => <p>Other page</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute, otherRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	const view = render(<RouterProvider router={router} />);
	await waitFor(() => screen.getByText("Home page"));
	return {router, container: view.container};
}

function frameRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector<HTMLElement>("[data-testid='app-frame']");
	if (!root) throw new Error("app frame not rendered");
	return root;
}

function sheet(): HTMLElement {
	const element = document.getElementById("sidebar-sheet");
	if (!element) throw new Error("sheet not rendered");
	return element;
}

function mainElement(container: HTMLElement): HTMLElement {
	const element = container.querySelector("main");
	if (!element) throw new Error("main not rendered");
	return element;
}

function clearanceVars(container: HTMLElement): {start: string; top: string} {
	const style = mainElement(container).style;
	return {
		start: style.getPropertyValue("--top-left-clearance-start"),
		top: style.getPropertyValue("--top-left-clearance-top"),
	};
}

async function openSheet() {
	const trigger = screen.getByRole("button", {name: "Show sidebar"});
	fireEvent.click(trigger);
	await waitFor(() => {
		expect(sheet().hasAttribute("data-open")).toBe(true);
	});
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	installLocalStorage();
});

describe("density scopes", () => {
	it("marks <main> compact with upstream's epitaxy-root base text classes and leaves the frame to inherit <html>", async () => {
		mockViewport(1440);
		const {container} = await renderFrame();
		const main = mainElement(container);

		expect({
			frame: frameRoot(container).getAttribute("data-density"),
			main: main.getAttribute("data-density"),
			text: main.className
				.split(" ")
				.filter((name) => ["text-body", "text-primary", "break-words", "select-none"].includes(name)),
		}).toStrictEqual({frame: null, main: "compact", text: ["text-body", "text-primary", "break-words"]});
	});

	it("provides the compact density to <main>'s children, so their menus and portals open compact", async () => {
		mockViewport(1440);
		await renderFrame();

		expect(screen.getByTestId("density-probe").textContent).toBe("compact");
	});

	it("turns <main> comfortable on a coarse pointer at desktop width, as upstream's si overrides fv's compact prop", async () => {
		mockViewport(900, {coarse: true});
		const {container} = await renderFrame();

		expect({
			main: mainElement(container).getAttribute("data-density"),
			children: screen.getByTestId("density-probe").textContent,
		}).toStrictEqual({main: "comfortable", children: "comfortable"});
	});
});

describe("phone sheet sidebar", () => {
	it("sizes the frame to the dynamic viewport rather than 100vh, so iOS never scrolls the titlebar away", async () => {
		mockViewport(390);
		const {container} = await renderFrame();

		expect(
			frameRoot(container)
				.className.split(" ")
				.filter((name) => name.startsWith("h-")),
		).toStrictEqual(["h-[var(--app-visual-viewport-height,100dvh)]"]);
	});

	it("marks the root and renders a closed modal sheet under 640px", async () => {
		mockViewport(390);
		const {container} = await renderFrame();

		expect(frameRoot(container).getAttribute("data-phone-sheet")).toBe("left");
		const trigger = screen.getByRole("button", {name: "Show sidebar"});
		expect({
			expanded: trigger.getAttribute("aria-expanded"),
			controls: trigger.getAttribute("aria-controls"),
			geometry: {
				left: trigger.style.left,
				top: trigger.style.top,
				width: trigger.style.width,
				height: trigger.style.height,
			},
		}).toStrictEqual({
			expanded: "false",
			controls: "sidebar-sheet",
			geometry: {left: "8px", top: "8px", width: "32px", height: "32px"},
		});
		expect({
			role: sheet().getAttribute("role"),
			modal: sheet().getAttribute("aria-modal"),
			open: sheet().hasAttribute("data-open"),
			inert: sheet().hasAttribute("inert"),
		}).toStrictEqual({role: "dialog", modal: "true", open: false, inert: true});
		expect({
			inert: mainElement(container).hasAttribute("inert"),
			clearance: clearanceVars(container),
		}).toStrictEqual({
			inert: false,
			clearance: {start: "41px", top: "9px"},
		});
	});

	it("opens from the trigger, focuses Close and makes main inert", async () => {
		mockViewport(390);
		const {container} = await renderFrame();

		await openSheet();

		const close = screen.getByRole("button", {name: "Close sidebar"});
		expect({
			expanded: screen.getByRole("button", {name: "Show sidebar"}).getAttribute("aria-expanded"),
			mainInert: mainElement(container).hasAttribute("inert"),
			sheetInert: sheet().hasAttribute("inert"),
			closeMarked: close.hasAttribute("data-phone-sheet-close"),
			focused: document.activeElement === close,
		}).toStrictEqual({
			expanded: "true",
			mainInert: true,
			sheetInert: false,
			closeMarked: true,
			focused: true,
		});
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		mockViewport(390);
		const {container} = await renderFrame();
		await openSheet();

		fireEvent.keyDown(document, {key: "Escape"});

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("button", {name: "Show sidebar"}));
		});
		expect({
			open: sheet().hasAttribute("data-open"),
			mainInert: mainElement(container).hasAttribute("inert"),
		}).toStrictEqual({open: false, mainInert: false});
	});

	it("closes from the Close button and returns focus to the trigger", async () => {
		mockViewport(390);
		const {container} = await renderFrame();
		await openSheet();

		fireEvent.click(screen.getByRole("button", {name: "Close sidebar"}));

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("button", {name: "Show sidebar"}));
		});
		expect({
			open: sheet().hasAttribute("data-open"),
			mainInert: mainElement(container).hasAttribute("inert"),
		}).toStrictEqual({open: false, mainInert: false});
	});

	it("draws Close sidebar as upstream's 20px X", async () => {
		mockViewport(390);
		await renderFrame();
		await openSheet();

		expect(
			screen
				.getByRole("button", {name: "Close sidebar"})
				.querySelector("svg")
				?.getAttribute("class")
				?.split(" ")
				.filter((name) => name.startsWith("lucide-") || name === "size-5"),
		).toStrictEqual(["lucide-x", "size-5"]);
	});

	it("ends the nav block 11px below More, as upstream's phone sheet does", async () => {
		mockViewport(390);
		await renderFrame();
		await openSheet();

		expect(sheet().querySelector("[data-nav-groups-gap]")?.className).toBe("h-[11px] shrink-0");
	});

	it("puts upstream's full-width Search button under Close and opens the palette in search mode", async () => {
		mockViewport(390);
		await renderFrame();
		await openSheet();

		const header = within(screen.getByTestId("phone-sheet-header"));
		const search = header.getByRole("button", {name: "Search"});
		expect({
			buttons: header
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label") ?? button.textContent),
			headerLayout: screen
				.getByTestId("phone-sheet-header")
				.className.split(" ")
				.filter((name) => ["flex-col", "gap-2"].includes(name)),
			closeRadius: header
				.getByRole("button", {name: "Close sidebar"})
				.className.split(" ")
				.filter((name) => name.startsWith("rounded")),
			searchBox: search.className
				.split(" ")
				.filter((name) => ["w-full", "h-10", "rounded-r7", "bg-fill-control", "px-4"].includes(name)),
			icon: search
				.querySelector("svg")
				?.getAttribute("class")
				?.split(" ")
				.filter((name) => name === "lucide-search" || name === "size-5" || name === "-ms-1"),
		}).toStrictEqual({
			buttons: ["Close sidebar", "Search"],
			headerLayout: ["flex-col", "gap-2"],
			closeRadius: ["rounded-r6"],
			searchBox: ["h-10", "w-full", "rounded-r7", "bg-fill-control", "px-4"],
			icon: ["lucide-search", "-ms-1", "size-5"],
		});

		fireEvent.click(search);

		await waitFor(() => {
			expect(screen.getByTestId("palette-probe").textContent).toBe("open:search");
		});
	});

	it("drops the Search icon from the sheet footer", async () => {
		mockViewport(390);
		await renderFrame();
		await openSheet();

		const footer = within(sheet()).getByTestId("sidebar-footer");
		expect({
			search: within(footer).queryByRole("button", {name: "Search"}),
			accountWidth: within(footer)
				.getByTestId("user-menu-button")
				.className.split(" ")
				.filter((name) => name === "w-full"),
		}).toStrictEqual({search: null, accountWidth: ["w-full"]});
	});

	it("closes when the route changes", async () => {
		mockViewport(390);
		const {router} = await renderFrame();
		await openSheet();

		await act(async () => router.navigate({to: "/plans"}));

		await waitFor(() => screen.getByText("Other page"));
		expect(sheet().hasAttribute("data-open")).toBe(false);
	});

	it("closes on browser Back (popstate)", async () => {
		mockViewport(390);
		await renderFrame();
		await openSheet();

		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		await waitFor(() => {
			expect(sheet().hasAttribute("data-open")).toBe(false);
		});
	});

	it("does not render the sheet at 640px and wider", async () => {
		mockViewport(640);
		const {container} = await renderFrame();

		expect({
			phoneSheet: frameRoot(container).hasAttribute("data-phone-sheet"),
			sheet: document.getElementById("sidebar-sheet"),
		}).toStrictEqual({phoneSheet: false, sheet: null});
	});
});

describe("narrow viewport forced collapse", () => {
	it("renders collapsed between 640 and 767px without touching the stored preference", async () => {
		mockViewport(700);
		writeSidebarState({...readSidebarState(), collapsed: false});
		const storedBefore = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
		const {container} = await renderFrame();

		const trigger = screen.getByRole("button", {name: "Show sidebar"});
		expect({
			phoneSheet: frameRoot(container).hasAttribute("data-phone-sheet"),
			collapsed: screen.queryByTestId("sidebar-collapsed") !== null,
			hide: screen.queryByRole("button", {name: "Hide sidebar"}),
			shortcut: trigger.getAttribute("aria-keyshortcuts"),
			stored: window.localStorage.getItem(SIDEBAR_STORAGE_KEY),
			storedCollapsed: readSidebarState().collapsed,
			clearance: clearanceVars(container),
		}).toStrictEqual({
			phoneSheet: false,
			collapsed: true,
			clearance: {start: "41px", top: "9px"},
			hide: null,
			shortcut: "Control+b",
			stored: storedBefore,
			storedCollapsed: false,
		});
	});

	it("opens the peek from a trigger click instead of changing the stored preference", async () => {
		mockViewport(700);
		writeSidebarState({...readSidebarState(), collapsed: false});
		const storedBefore = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
		await renderFrame();

		fireEvent.click(screen.getByRole("button", {name: "Show sidebar"}));

		expect({
			hovering: screen.getByTestId("sidebar-collapsed").hasAttribute("data-hovering"),
			stored: window.localStorage.getItem(SIDEBAR_STORAGE_KEY),
		}).toStrictEqual({hovering: true, stored: storedBefore});
	});

	it("keeps the peek open after hover plus click and closes it on an outside press", async () => {
		mockViewport(700);
		const {container} = await renderFrame();
		const trigger = screen.getByRole("button", {name: "Show sidebar"});
		const root = screen.getByTestId("sidebar-collapsed");

		act(() => {
			fireEvent.pointerEnter(trigger);
		});
		fireEvent.click(trigger);
		const afterClick = root.hasAttribute("data-hovering");

		act(() => {
			fireEvent.pointerDown(mainElement(container));
		});

		expect({afterClick, afterOutside: root.hasAttribute("data-hovering")}).toStrictEqual({
			afterClick: true,
			afterOutside: false,
		});
	});

	it("docks the expanded sidebar at 768px and wider", async () => {
		mockViewport(768);
		writeSidebarState({...readSidebarState(), collapsed: false});
		const {container} = await renderFrame();

		expect({
			collapsed: screen.queryByTestId("sidebar-collapsed"),
			hide: screen.getByRole("button", {name: "Hide sidebar"}).tagName,
			clearance: clearanceVars(container),
		}).toStrictEqual({collapsed: null, hide: "BUTTON", clearance: {start: "", top: ""}});
	});

	it("marks the main column with the upstream data-perf-region anchor", async () => {
		mockViewport(1024);
		const {container} = await renderFrame();

		expect(mainElement(container).getAttribute("data-perf-region")).toBe("main");
	});

	it("makes the main column a containing block so absolute descendants cannot stretch the document", async () => {
		mockViewport(390);
		const {container} = await renderFrame();

		expect(mainElement(container).classList.contains("relative")).toBe(true);
	});
});

describe("phone sheet CSS", () => {
	const styles = readFileSync("src/styles/globals.css", "utf8");
	const rule = (selector: string) => {
		const start = styles.indexOf(`${selector} {`);
		return styles.slice(start, styles.indexOf("}", start));
	};

	it("insets the sheet only for safe areas, so its rows sit 8px in as upstream's px-2 body", () => {
		expect(/padding:[^;]*max\(8px/.test(rule("\n.phone-sheet"))).toBe(false);
	});

	it("keeps an expanded sidebar group's caret visible on touch, as upstream's [data-group-caret] touch rule", () => {
		const caret = styles.indexOf("\t[data-group-caret] {");
		const media = styles.lastIndexOf("\n@media ", caret);
		expect({
			touchMedia:
				styles.startsWith("\n@media (pointer: coarse), (hover: none) {", media) &&
				!styles.slice(media, caret).includes("\n}"),
			rule: rule("\t[data-group-caret]").trim(),
		}).toStrictEqual({touchMedia: true, rule: "[data-group-caret] {\n\t\topacity: 1;"});
	});

	it("bands phone-sheet group labels as upstream's df-session-list: 8px + row-height label, 2px row stack, no group padding", () => {
		const sheet = rule("\n.phone-sheet");
		const vars = Object.fromEntries(
			[...sheet.matchAll(/(--sb-(?:group|row-stack)[\w-]*): ([^;]+);/g)].map((match) => [match[1], match[2]]),
		);
		expect(vars).toStrictEqual({
			"--sb-row-stack-gap": "2px",
			"--sb-group-band-mt": "calc(10px - var(--sb-row-stack-gap))",
			"--sb-group-band-h": "var(--sb-row-h)",
			"--sb-group-pt": "0px",
			"--sb-group-label-pb": "0px",
			"--sb-group-pb": "0px",
		});
	});

	it("drives sidebar group spacing from the band and stack-gap variables", () => {
		const source = readFileSync("src/components/sidebar/session-group-section.tsx", "utf8");
		expect({
			stackGaps: source.split("gap-[var(--sb-row-stack-gap)]").length - 1,
			bandMargins: source.split("mt-[var(--sb-group-band-mt)] min-h-[var(--sb-group-band-h)]").length - 1,
			labelPadding:
				source.split("pt-[var(--sb-group-pt)] pr-[var(--sb-row-ctl-inset)] pb-[var(--sb-group-label-pb)]")
					.length - 1,
			oldMinHeight: source.includes("min-h-[calc(var(--sb-group-pt)"),
		}).toStrictEqual({stackGaps: 3, bandMargins: 2, labelPadding: 2, oldMinHeight: false});
	});

	it("reveals the touch kebab only on the data-touch-menu row, for touch pointers, not every phone-width mouse", () => {
		const reveal = styles.indexOf("[data-touch-menu] .df-touch-reveal {");
		const before = styles.slice(Math.max(0, reveal - 200), reveal);
		expect({
			touchMedia: /@media \(pointer: coarse\), \(hover: none\) \{\s*$/.test(before),
			sheetWide: styles.includes(".phone-sheet .df-touch-reveal"),
			hidesDecoration: rule("\t[data-touch-menu] [data-row-decoration]").includes("opacity: 0"),
			clearsLabel: rule("\t[data-touch-menu] [data-row-main-button] [data-row-label]").includes(
				"padding-inline-end: calc(var(--sb-row-ctl) + 4px)",
			),
		}).toStrictEqual({touchMedia: true, sheetWide: false, hidesDecoration: true, clearsLabel: true});
	});
});
