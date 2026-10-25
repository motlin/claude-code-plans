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

async function renderSidebar(props: {collapsed?: boolean; phoneSheet?: boolean; palette?: boolean} = {}) {
	const queryClient = seedQueryClient();
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<SettingsProvider>
						<Sidebar
							collapsed={props.collapsed ?? false}
							{...(props.phoneSheet ? {onPhoneSheetClose: () => {}} : {})}
						/>
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

describe("sidebar search field", () => {
	it("renders a Search button above New in the docked sidebar", async () => {
		await renderSidebar();

		const field = within(sidebarNav()).getAllByRole("button", {name: "Search"})[0];
		const newRow = within(sidebarNav()).getByRole("link", {name: /^New/});

		expect({
			isField: field !== undefined && field === searchField(),
			precedesNew:
				field !== undefined && (field.compareDocumentPosition(newRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
		}).toStrictEqual({isField: true, precedesNew: true});
	});

	it("exposes the ⌘K default-entry shortcut and roving attributes", async () => {
		await renderSidebar();

		const field = searchField();
		const keys = field?.querySelector(".df-search-field-keys");
		const shortcut = keys?.querySelector("[data-cds=Shortcut][data-variant=keycap]");
		const wrapper = field?.parentElement;

		expect({
			type: field?.getAttribute("type"),
			roving: field?.getAttribute("data-roving-item"),
			ariaKeyShortcuts: field?.getAttribute("aria-keyshortcuts"),
			leadingSlot: field?.querySelector("[data-leading-slot] svg") !== null,
			label: field?.querySelector("[data-row-label]")?.textContent,
			keysHidden: keys?.getAttribute("aria-hidden"),
			keycaps: [...(shortcut?.querySelectorAll("kbd") ?? [])].map(
				(kbd) => kbd.querySelector("[aria-hidden]")?.textContent ?? kbd.textContent,
			),
			wrapperTag: wrapper?.tagName,
			wrapperClass: wrapper?.className,
			wrapperTabSection: wrapper?.getAttribute("data-tab-section"),
		}).toStrictEqual({
			type: "button",
			roving: "",
			ariaKeyShortcuts: "Control+k",
			leadingSlot: true,
			label: "Search",
			keysHidden: "true",
			keycaps: ["Ctrl", "K"],
			wrapperTag: "DIV",
			wrapperClass: "mb-2",
			wrapperTabSection: "",
		});
	});

	it("builds the field on the --sb-* row tokens", async () => {
		await renderSidebar();

		const classes = searchField()?.className.split(" ") ?? [];

		expect(
			[
				"df-search-field",
				"hit-row",
				"hit-row-main",
				"[--cds-hit-gap-y:10px]",
				"h-[var(--sb-row-h)]",
				"gap-[var(--sb-row-gap)]",
				"rounded-[var(--sb-radius)]",
				"bg-[var(--sb-field-bg)]",
				"px-[var(--sb-row-px)]",
				"text-[length:var(--sb-row-font)]",
				"text-ink-muted",
			].filter((token) => !classes.includes(token)),
		).toStrictEqual([]);
	});

	it("is shown in the collapsed peek", async () => {
		await renderSidebar({collapsed: true});

		expect(searchField() === null).toBe(false);
	});

	it("is not rendered in the phone sheet, which keeps its own header Search button", async () => {
		await renderSidebar({phoneSheet: true});

		expect(searchField()).toBeNull();
	});

	it("never takes focus on mouse down", async () => {
		await renderSidebar();

		const field = searchField();

		expect(field !== null && fireEvent.mouseDown(field)).toBe(false);
	});

	it("opens the ⌘K default entry in Search without overwriting a remembered Compose tab", async () => {
		localStorage.setItem("cmdk-mode", "compose");
		await renderSidebar({palette: true});

		const field = searchField();
		if (field === null) throw new Error("No search field");
		fireEvent.click(field);
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		const input = await within(dialog).findByRole("combobox", {name: "Search"});

		expect({
			placeholder: input.getAttribute("placeholder"),
			modeSwitch: within(dialog).queryByRole("radiogroup", {name: "Search or compose"}) !== null,
			stored: localStorage.getItem("cmdk-mode"),
		}).toStrictEqual({placeholder: "Search", modeSwitch: false, stored: "compose"});
	});
	it("returns focus to the previously focused element after a mouse open and close", async () => {
		await renderSidebar({palette: true});

		const field = searchField();
		if (field === null) throw new Error("No search field");
		// jsdom skips the browser's focus-on-mousedown default, so apply it unless the field prevented it.
		if (fireEvent.mouseDown(field)) field.focus();
		fireEvent.click(field);
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		fireEvent.keyDown(within(dialog).getByRole("combobox", {name: "Search"}), {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});

		await waitFor(() => {
			expect(document.activeElement === field ? "field" : document.activeElement?.tagName).toBe("BODY");
		});
	});

	it("returns focus to the field after a keyboard open and close", async () => {
		await renderSidebar({palette: true});

		const field = searchField();
		if (field === null) throw new Error("No search field");
		field.focus();
		fireEvent.click(field);
		const dialog = await screen.findByRole("dialog", {name: "Search"});
		fireEvent.keyDown(within(dialog).getByRole("combobox", {name: "Search"}), {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Search"})).toBeNull();
		});

		await waitFor(() => {
			expect(document.activeElement === field ? "field" : document.activeElement?.tagName).toBe("field");
		});
	});
});
