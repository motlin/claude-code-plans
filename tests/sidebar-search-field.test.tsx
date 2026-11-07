// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {DEFAULTS} from "../src/components/settings-context";
import {Sidebar} from "../src/components/sidebar/Sidebar";
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {applicationSettingsQueryOptions} from "../src/lib/api/application-settings";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {activeSessionsQueryOptions, recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {installLocalStorage} from "./fake-storage";
import {NAV_SECTIONS} from "../src/lib/nav-sections";
import {ToastProvider} from "../src/components/toast";
import {CompactScope, PanelsOff} from "./fizzy-lake-off";

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
	queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
		sessions: [],
		nextCursor: null,
	});
	return queryClient;
}

function Palette() {
	return <CommandPalette {...useCommandPalette()} />;
}

async function renderSidebar(
	props: {
		collapsed?: boolean;
		phoneSheet?: boolean;
		palette?: boolean;
		compactAncestor?: boolean;
		panelsOff?: boolean;
	} = {},
) {
	const queryClient = seedQueryClient();
	const docked = (
		<Sidebar collapsed={props.collapsed ?? false} {...(props.phoneSheet ? {onPhoneSheetClose: () => {}} : {})} />
	);
	const sidebar = props.panelsOff === true ? <PanelsOff>{docked}</PanelsOff> : docked;
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						{props.compactAncestor === true ? <CompactScope>{sidebar}</CompactScope> : sidebar}
						{props.palette === true && <Palette />}
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
	return waitFor(() => screen.getByTestId("sidebar-footer"));
}

function sidebarNav(): HTMLElement {
	const nav = document.querySelector<HTMLElement>("nav[aria-label=Sidebar]");
	if (nav === null) throw new Error("No Sidebar nav rendered");
	return nav;
}

function searchField(): HTMLElement | null {
	return sidebarNav().querySelector<HTMLElement>("button.df-search-field");
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

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
	Element.prototype.scrollIntoView = () => {};
});

function searchRow(): HTMLElement | null {
	return sidebarNav().querySelector<HTMLElement>("button[data-row-nav][data-row-main-button]");
}

function newRow(): HTMLElement {
	// The collapsed peek is inert until hovered, so its rows are hidden from the accessibility tree.
	return within(sidebarNav()).getByRole("link", {name: "New", hidden: true});
}

/* Upstream fizzy-lake `panels` with the hub rail: the Search nav row under New (`Gx`, non-classic). */
describe("sidebar Search row", () => {
	it("renders one Search nav row right after New, then the h-1 spacer, and no old field", async () => {
		await renderSidebar();

		const row = searchRow();
		const header = row?.parentElement;

		expect({
			fields: sidebarNav().querySelectorAll(".df-search-field").length,
			searchButtons: within(sidebarNav())
				.getAllByRole("button", {name: "Search"})
				.map((button) => button === row),
			header: [
				header?.children[0]?.contains(newRow()),
				header?.children[1] === row,
				header?.children[2]?.outerHTML,
				header?.children.length,
			],
			tabSection: row?.closest("[data-tab-section]") ?? null,
		}).toStrictEqual({
			fields: 0,
			searchButtons: [true],
			header: [true, true, '<div aria-hidden="true" class="h-1 shrink-0"></div>', 3],
			tabSection: null,
		});
	});

	it("carries upstream's row attributes, 20px icon in the rail slot, fade-truncated label and text ⌘K hint", async () => {
		await renderSidebar();

		const row = searchRow();
		const hint = row?.querySelector("[data-cds=Shortcut]");

		expect({
			type: row?.getAttribute("type"),
			attributes: ["data-row", "data-roving-item", "data-row-main-button", "data-row-nav"].map((name) =>
				row?.getAttribute(name),
			),
			ariaKeyShortcuts: row?.getAttribute("aria-keyshortcuts"),
			leadingSlot: row?.querySelector("[data-leading-slot]")?.className,
			icon: row?.querySelector("[data-leading-slot] > svg") !== null,
			label: row?.querySelector(".df-fade-truncate")?.className,
			labelText: row?.querySelector(".df-fade-truncate")?.textContent,
			labelWrapper: row?.querySelector(".df-fade-truncate")?.parentElement?.className,
			hintHidden: hint?.getAttribute("aria-hidden"),
			hintVariant: hint?.getAttribute("data-variant"),
			hintClasses: [
				"ms-1",
				"me-[var(--sb-radius)]",
				"leading-none",
				"text-muted-as-secondary",
				"[--shortcut-cap-ink:currentColor]",
				"opacity-0",
				"group-hover:opacity-100",
			].filter((token) => hint?.classList.contains(token) !== true),
			hintText: hint?.textContent,
		}).toStrictEqual({
			type: "button",
			attributes: ["", "", "", ""],
			ariaKeyShortcuts: "Control+k",
			leadingSlot: "df-on-rail df-leading-slot",
			icon: true,
			label: "df-fade-truncate whitespace-nowrap",
			labelText: "Search",
			labelWrapper: "flex min-w-0 flex-1 items-center",
			hintHidden: "true",
			hintVariant: "text",
			hintClasses: [],
			hintText: "Ctrl+K",
		});
	});

	/* Upstream's New carries mt-1 to land at y=52 on the dock; the local header already starts there, so New takes no margin. */
	it("shares New's row classes and hint classes exactly", async () => {
		await renderSidebar();

		const row = searchRow();
		const newClasses = newRow().className.split(" ");
		const rowClasses = row?.className.split(" ") ?? [];
		const hintOf = (element: Element | null | undefined) =>
			element?.querySelector("[data-cds=Shortcut]")?.className.split(" ") ?? [];

		expect({
			onlyNew: newClasses.filter((token) => !rowClasses.includes(token)),
			onlyRow: rowClasses.filter((token) => !newClasses.includes(token)),
			hint: hintOf(newRow()).toSorted(),
			noFocusVisibleHint: [...hintOf(row), ...hintOf(newRow())].filter((token) =>
				token.startsWith("group-focus-visible:"),
			),
		}).toStrictEqual({
			onlyNew: [],
			onlyRow: [],
			hint: hintOf(row).toSorted(),
			noFocusVisibleHint: [],
		});
	});

	it("is shown under New in the collapsed peek", async () => {
		await renderSidebar({collapsed: true});

		const row = searchRow();

		expect(row !== null && (newRow().compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
			true,
		);
	});

	it("is not rendered in the phone sheet, which keeps its own header Search button", async () => {
		await renderSidebar({phoneSheet: true});

		expect(searchRow()).toBeNull();
	});

	it("never takes focus on mouse down", async () => {
		await renderSidebar();

		const row = searchRow();

		expect(row !== null && fireEvent.mouseDown(row)).toBe(false);
	});

	it("opens the ⌘K default entry in Search without overwriting a remembered Compose tab", async () => {
		localStorage.setItem("cmdk-mode", "compose");
		await renderSidebar({palette: true});

		const row = searchRow();
		if (row === null) throw new Error("No Search row");
		fireEvent.click(row);
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		const input = await within(dialog).findByRole("combobox", {name: "Search"});

		expect({
			placeholder: input.getAttribute("placeholder"),
			modeSwitch: within(dialog).queryByRole("radiogroup", {name: "Search or compose"}) !== null,
			stored: localStorage.getItem("cmdk-mode"),
		}).toStrictEqual({placeholder: "Search", modeSwitch: false, stored: "compose"});
	});
});

// Upstream's `R8` aside hard-codes data-flat-look="" and carries data-hub-rail in the hub layout, and its
// graduated header has no Search field above New, whatever fizzy-lake parts are on.
describe("sidebar root attributes with fizzy-lake panels off", () => {
	it.each([
		{mode: "docked", props: {}},
		{mode: "collapsed peek", props: {collapsed: true}},
		{mode: "phone sheet", props: {phoneSheet: true}},
	])("marks the $mode nav data-flat-look and data-hub-rail, with no Search field", async ({props}) => {
		await renderSidebar({...props, panelsOff: true});
		const nav = sidebarNav();

		expect({
			flatLook: nav.getAttribute("data-flat-look"),
			hubRail: nav.getAttribute("data-hub-rail"),
			field: searchField(),
		}).toStrictEqual({flatLook: "", hubRail: "", field: null});
	});
});

describe("sidebar density scope", () => {
	async function densities(props: {collapsed?: boolean; phoneSheet?: boolean}) {
		await renderSidebar({...props, compactAncestor: true});
		const nav = sidebarNav();
		fireEvent.click(within(nav).getByRole("button", {name: "More navigation items", hidden: true}));
		const menu = await screen.findByRole("menu", {hidden: true});
		return {
			nav: nav.getAttribute("data-density"),
			menu: menu.closest("[data-density]")?.getAttribute("data-density"),
		};
	}

	/* Upstream pins aside.dframe-sidebar[data-density=comfortable] (web default), so a compact ancestor never pulls it along. */
	it("pins the docked sidebar comfortable under a compact ancestor, and its menus portal comfortable", async () => {
		expect(await densities({})).toStrictEqual({nav: "comfortable", menu: "comfortable"});
	});

	it("pins the collapsed peek sidebar comfortable under a compact ancestor", async () => {
		expect(await densities({collapsed: true})).toStrictEqual({
			nav: "comfortable",
			menu: "comfortable",
		});
	});

	it("pins the phone sheet sidebar comfortable under a compact ancestor", async () => {
		expect(await densities({phoneSheet: true})).toStrictEqual({
			nav: "comfortable",
			menu: "comfortable",
		});
	});
});
