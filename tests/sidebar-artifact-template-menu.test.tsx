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
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions} from "../src/lib/api/sessions";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";
import type {NavSection} from "../src/lib/nav-sections";
import {ToastProvider} from "../src/components/toast";
import {installLocalStorage} from "./fake-storage";

const BASE_SETTINGS = {
	terminalWritesEnabled: false,
	terminalHost: "auto" as const,
	shellPaneEnabled: true,
	ignoredDirs: ["node_modules"],
};

function seedQueryClient(visibleNavSections: NavSection[]): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {notifications: []});
	queryClient.setQueryData(activeSessionsQueryOptions(DEFAULTS.activeTimeoutSec * 1000).queryKey, []);
	queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, {
		...BASE_SETTINGS,
		visibleNavSections,
	});
	return queryClient;
}

function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url === "/api/application-settings" && init?.method === "PUT") {
				const body: unknown = JSON.parse(String(init.body));
				return Promise.resolve(Response.json(body));
			}
			return new Promise<Response>(() => {});
		}),
	);
}

async function renderSidebar(
	visibleNavSections: NavSection[] = ["artifacts", "plans", "memories", "customize"],
	initialPath = "/plans",
	fizzyLakeParts?: readonly FizzyLakePart[],
) {
	const queryClient = seedQueryClient(visibleNavSections);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						{fizzyLakeParts === undefined ? (
							<Sidebar collapsed={false} />
						) : (
							<FizzyLakeContext.Provider value={fizzyLakeParts}>
								<Sidebar collapsed={false} />
							</FizzyLakeContext.Provider>
						)}
						<Outlet />
					</SettingsProvider>
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const pageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "$",
		component: () => null,
	});
	const routinesRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "routines",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([routinesRoute, pageRoute]),
		history: createMemoryHistory({initialEntries: [initialPath]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByRole("link", {name: "Plans"});
	return {router, queryClient};
}

function plusButton(): HTMLElement {
	return screen.getByRole("button", {name: "New from a template"});
}

async function openTemplateMenu(): Promise<HTMLElement> {
	fireEvent.click(plusButton());
	return screen.findByRole("menu", {name: "New from a template"});
}

beforeEach(() => {
	installLocalStorage();
	stubFetch();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("sidebar Artifacts template launcher", () => {
	it("puts upstream's hidden-at-rest + row action in the Artifacts row, out of the Tab order", async () => {
		await renderSidebar();
		const plus = plusButton();
		const row = plus.closest("[data-row]");
		expect({
			tabIndex: plus.getAttribute("tabindex"),
			rowAction: plus.hasAttribute("data-row-action"),
			rowLinks: row === null ? [] : [...row.querySelectorAll("a")].map((link) => link.textContent),
			linkIsRow: screen.getByRole("link", {name: "Artifacts"}).hasAttribute("data-row"),
			glyph: plus
				.querySelector("svg")
				?.getAttribute("class")
				?.split(" ")
				.find((name) => name.startsWith("lucide-") && name !== "lucide-icon"),
		}).toStrictEqual({
			tabIndex: "-1",
			rowAction: true,
			rowLinks: ["Artifacts"],
			linkIsRow: false,
			glyph: "lucide-plus",
		});
	});

	it("has no + when Artifacts is not pinned", async () => {
		await renderSidebar(["plans", "memories", "customize"]);
		expect(screen.queryByRole("button", {name: "New from a template"})).toBeNull();
	});

	it("opens upstream's template menu: Docs, Slides, Design, a separator, Dashboard, then the footer", async () => {
		await renderSidebar();
		const menu = await openTemplateMenu();
		expect({
			expanded: plusButton().getAttribute("aria-expanded"),
			rows: [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((element) =>
				element.getAttribute("role") === "separator" ? "---" : element.textContent,
			),
			footer: within(menu).getByText(/^Opens a new session/).textContent,
		}).toStrictEqual({
			expanded: "true",
			rows: ["DocsNew", "SlidesNew", "DesignNew", "---", "DashboardBeta", "---"],
			footer: "Opens a new session ready to make what you pick. Nothing is created until you send.",
		});
	});

	it("opens home with ?create=<slug> when a template is picked", async () => {
		const {router} = await renderSidebar();
		const menu = await openTemplateMenu();
		fireEvent.click(within(menu).getByRole("menuitem", {name: /^Docs/}));
		await waitFor(() => {
			expect(router.state.location.href).toBe("/?create=pages");
		});
	});

	it("hops focus from the Artifacts link to + with ArrowRight and back with ArrowLeft", async () => {
		await renderSidebar();
		const link = screen.getByRole("link", {name: "Artifacts"});
		link.focus();
		fireEvent.keyDown(link, {key: "ArrowRight"});
		const afterRight = document.activeElement;
		fireEvent.keyDown(plusButton(), {key: "ArrowLeft"});
		expect({afterRight: afterRight === plusButton(), afterLeft: document.activeElement === link}).toStrictEqual({
			afterRight: true,
			afterLeft: true,
		});
	});

	it("returns focus to + when Escape closes the menu", async () => {
		await renderSidebar();
		const menu = await openTemplateMenu();
		fireEvent.keyDown(menu, {key: "Escape"});
		await waitFor(() => {
			expect({
				menu: screen.queryByRole("menu", {name: "New from a template"}),
				focused: document.activeElement === plusButton(),
			}).toStrictEqual({menu: null, focused: true});
		});
	});
	function readMarks(menu: HTMLElement) {
		return [...menu.querySelectorAll<HTMLElement>('[data-artifact-mark-size="menu"]')].map((mark) => ({
			kind: mark.dataset["artifactMark"],
			className: mark.className,
			svgSize: mark.querySelector("svg")?.style.fontSize,
		}));
	}

	const glyph = (kind: string, hue: string) => ({
		kind,
		className: `flex shrink-0 items-center justify-center text-tint-${hue}`,
		svgSize: "calc(1.25rem * var(--cds-rem-scale, 1))",
	});
	const MARKS = [
		glyph("document", "blue"),
		glyph("slides", "orange"),
		glyph("design", "violet"),
		glyph("chart", "red"),
	];

	it("marks each template row with upstream's ArtifactMark at menu size: a bare 20px tinted outline glyph", async () => {
		await renderSidebar();
		const menu = await openTemplateMenu();
		expect({
			marks: readMarks(menu),
			legacyTiles: menu.querySelectorAll("[data-template-tile]").length,
		}).toStrictEqual({marks: MARKS, legacyTiles: 0});
	});

	// Upstream removed the fizzy-lake color fork (and its solid `pK` tile) in shared-9-7C8cOdSN.
	it("draws the same marks when the fizzy-lake color part is off", async () => {
		await renderSidebar(undefined, undefined, ["panels", "type"]);
		const menu = await openTemplateMenu();
		expect(readMarks(menu)).toStrictEqual(MARKS);
	});

	// Upstream's `R8` aside hard-codes data-flat-look="" and carries data-hub-rail in the hub layout.
	it("marks the sidebar nav data-flat-look and data-hub-rail whatever fizzy-lake parts are on", async () => {
		const attributes = async (parts: readonly FizzyLakePart[]) => {
			await renderSidebar(undefined, undefined, parts);
			const nav = screen.getByRole("navigation", {name: "Sidebar"});
			const value = {flatLook: nav.getAttribute("data-flat-look"), hubRail: nav.getAttribute("data-hub-rail")};
			cleanup();
			return value;
		};
		expect({
			panels: await attributes(["color", "panels", "type"]),
			off: await attributes([]),
		}).toStrictEqual({panels: {flatLook: "", hubRail: ""}, off: {flatLook: "", hubRail: ""}});
	});

	it("tags the nav rows with upstream's data-nav-item ids", async () => {
		await renderSidebar();
		const navItem = (id: string) => document.querySelector(`[data-nav-item="${id}"]`);
		expect({
			artifacts: navItem("epitaxy-apps") === screen.getByRole("link", {name: "Artifacts"}),
			customize: navItem("customize") === screen.getByRole("link", {name: "Customize"}),
			more: navItem("more") === screen.getByRole("button", {name: "More navigation items"}),
			plans: navItem("local-plans") === screen.getByRole("link", {name: "Plans"}),
		}).toStrictEqual({artifacts: true, customize: true, more: true, plans: true});
	});
});
