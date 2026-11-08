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
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {preloadCustomizeDialogPanel} from "../src/components/settings/customize-dialog-panel-loader";
import {DeferredSettingsDialog} from "../src/components/settings/settings-dialog-entry";
import {loadSettingsDialog} from "../src/components/settings/settings-dialog-loader";
import {SettingsProvider} from "../src/components/settings-provider";
import {ThemeProvider} from "../src/components/theme-provider";
import {ToastProvider} from "../src/components/toast";
import {DensityScope} from "../src/components/ui/density";
import {
	customizeSkillDetailQueryOptions,
	customizeSkillsQueryOptions,
	type SkillDetail,
	type SkillSummary,
} from "../src/lib/api/customize";
import {DIALOG_BODY_CLASS} from "../src/components/ui/dialog-classes";
import {PHONE_SHEET_QUERY, SETTINGS_PHONE_QUERY, SETTINGS_WIDE_QUERY} from "../src/lib/use-phone-sheet";
import {redirectToSettingsDialog} from "../src/routes/settings";
import {installLocalStorage} from "./fake-storage";

/** Stub matchMedia so exactly the given queries match. */
function stubBrowser(matching: readonly string[] = []) {
	installLocalStorage();
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: matching.includes(query),
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}));
}

function buildRouter(initialEntry: string, seed: (queryClient: QueryClient) => void = () => {}) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	seed(queryClient);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<SettingsProvider>
						<ToastProvider>
							<Outlet />
							<DeferredSettingsDialog />
						</ToastProvider>
					</SettingsProvider>
				</ThemeProvider>
			</QueryClientProvider>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<div>
				<button type="button">Page trigger</button>
				<textarea aria-label="Page composer" />
			</div>
		),
	});
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings",
		beforeLoad: redirectToSettingsDialog,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
}

async function renderAt(initialEntry: string, seed?: (queryClient: QueryClient) => void) {
	const router = buildRouter(initialEntry, seed);
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

function location(router: ReturnType<typeof buildRouter>) {
	return {pathname: router.state.location.pathname, hash: router.state.location.hash};
}

function currentTabs(): string[] {
	const nav = screen.getByRole("navigation", {name: "Settings"});
	return [...nav.querySelectorAll('[aria-current="page"]')].map((tab) => tab.textContent);
}

// The modal's module loads on first open. Without this, the first test to open it pays for importing the Settings
// module graph inside findBy's 1s window, which times out under heavy parallel load.
beforeAll(async () => {
	await loadSettingsDialog();
});

describe("SettingsDialog", () => {
	beforeEach(() => {
		stubBrowser();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("stays closed without a settings hash", async () => {
		await renderAt("/");
		await screen.findByRole("button", {name: "Page trigger"});

		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("forces comfortable density on the modal even when opened from a compact scope, as upstream's shared-19", async () => {
		const router = buildRouter("/#settings/general");
		await router.load();
		render(
			<DensityScope density="compact">
				<RouterProvider router={router} />
			</DensityScope>,
		);

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		expect(dialog.parentElement?.closest("[data-density]")?.getAttribute("data-density")).toBe("comfortable");
	});

	it("fades and scales the popup and fades the backdrop on open and close, as upstream's 0.2s ease-out", async () => {
		await renderAt("/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const backdrop = dialog.parentElement?.querySelector(":scope > [role='presentation']");
		const popupClasses = dialog.className.split(" ");
		const backdropClasses = backdrop?.className.split(" ") ?? [];
		const popupExpected = [
			"transition-[opacity,scale]",
			"duration-200",
			"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
			"data-[starting-style]:opacity-0",
			"data-[starting-style]:scale-[0.98]",
			"data-[ending-style]:opacity-0",
			"data-[ending-style]:scale-[0.98]",
			"motion-reduce:transition-none",
			"motion-reduce:data-[starting-style]:scale-100",
			"dark:border",
			"dark:border-white/5",
		];
		const backdropExpected = [
			"bg-black/40",
			"dark:bg-black/50",
			"transition-opacity",
			"duration-200",
			"data-[starting-style]:opacity-0",
			"data-[ending-style]:opacity-0",
			"motion-reduce:transition-none",
		];
		expect({
			popup: popupExpected.filter((name) => popupClasses.includes(name)),
			backdrop: backdropExpected.filter((name) => backdropClasses.includes(name)),
		}).toStrictEqual({popup: popupExpected, backdrop: backdropExpected});
	});

	// Upstream's 2026-11 shell: a grid whose full-width settings-top-row band (visible "Settings" title + the
	// dialog's only Close) sits above the nav and the panel; the panel header and sticky top fade are gone.
	it("lays the desktop shell out as upstream's grid under a full-width settings-top-row band", async () => {
		await renderAt("/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const contents = dialog.firstElementChild;
		const [nav, topRow, panel] = [...(contents?.children ?? [])];
		const scroller = panel?.firstElementChild ?? null;
		const popupClasses = dialog.className.split(" ");
		const heading = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");

		expect({
			grid: ["grid", "grid-cols-[auto_minmax(0,1fr)]", "grid-rows-[auto_minmax(0,1fr)]", "flex"].filter((name) =>
				popupClasses.includes(name),
			),
			contents: [contents?.tagName, contents?.className, contents?.childElementCount],
			nav: [nav?.tagName, nav?.classList.contains("row-start-2")],
			headingInNav: heading !== null && nav?.contains(heading),
			topRow: [topRow?.getAttribute("data-testid"), topRow?.className],
			topRowChildren: [...(topRow?.children ?? [])].map((child) => ({
				tag: child.tagName,
				ariaHidden: child.getAttribute("aria-hidden"),
				ariaLabel: child.getAttribute("aria-label"),
				text: child.textContent,
				classes:
					child.tagName === "BUTTON"
						? ["size-7", "rounded-r6"].filter((name) => child.classList.contains(name))
						: child.className,
			})),
			closes: within(dialog).getAllByRole("button", {name: "Close"}).length,
			panel: panel?.className,
			scroller: scroller?.className,
			firstScrollChildIsFade: scroller?.firstElementChild?.classList.contains("sticky"),
		}).toStrictEqual({
			grid: ["grid", "grid-cols-[auto_minmax(0,1fr)]", "grid-rows-[auto_minmax(0,1fr)]"],
			contents: ["DIV", "contents", 3],
			nav: ["NAV", true],
			headingInNav: true,
			topRow: [
				"settings-top-row",
				"col-span-full row-start-1 flex shrink-0 items-center justify-between gap-3 border-b border-[rgb(0_0_0/0.12)] dark:border-white/10 ps-4 pe-2 min-h-11",
			],
			topRowChildren: [
				{
					tag: "DIV",
					ariaHidden: "true",
					ariaLabel: null,
					text: "Settings",
					classes: "min-w-0 [overflow-wrap:anywhere] text-[15px]/[20px] font-[520] text-primary",
				},
				{tag: "BUTTON", ariaHidden: null, ariaLabel: "Close", text: "", classes: ["size-7", "rounded-r6"]},
			],
			closes: 1,
			panel: "flex min-h-0 min-w-0 flex-1 flex-col",
			scroller: "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]",
			firstScrollChildIsFade: false,
		});
	});

	// Upstream's nav column: w-53 (212px) with the fizzy-lake seam, px-lg/pt-lg search, and the grouped
	// nav's untitled lists split by hairline separators.
	it("sizes the nav column, search wrapper, list and separators like upstream", async () => {
		await renderAt("/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const nav = within(dialog).getByRole("navigation", {name: "Settings"});
		const search = within(nav).getByRole("textbox", {name: "Search settings"});
		const searchWrap = [...nav.children].find((child) => child.contains(search));
		const lists = within(nav).getAllByRole("list");
		const listWrap = lists[0]?.parentElement;

		expect({
			nav: nav.className,
			searchWrap: searchWrap?.className,
			list: listWrap?.className,
			children: [...(listWrap?.children ?? [])].map((child) => [
				child.tagName,
				child.className,
				child.getAttribute("aria-hidden"),
				child.getAttribute("aria-labelledby"),
			]),
		}).toStrictEqual({
			nav: "row-start-2 flex w-[212px] min-h-0 shrink-0 flex-col border-e border-[rgb(0_0_0/0.1)] dark:border-white/10 bg-surface-1",
			searchWrap: "shrink-0 px-4 pt-4",
			list: "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-fade-y scroll-fade-hide-top scroll-fade-size-6 scroll-pt-2 px-4 pt-3 pb-4",
			children: [
				["UL", "flex flex-col hit-gap-y-px", null, null],
				["DIV", "mx-2 border-t border-alpha-2", "true", null],
				["UL", "flex flex-col hit-gap-y-px", null, null],
				["DIV", "mx-2 border-t border-alpha-2", "true", null],
				["UL", "flex flex-col hit-gap-y-px", null, null],
				["DIV", "mx-2 border-t border-alpha-2", "true", null],
				["UL", "flex flex-col hit-gap-y-px", null, null],
			],
		});
	});

	it("opens on the hash's tab with that tab marked current", async () => {
		await renderAt("/#settings/sessions");

		await screen.findByRole("dialog", {name: "Settings"});
		// Upstream's panel starts with an sr-only h2 named by the nav row, then the section headings.
		expect({
			current: currentTabs(),
			tabHeading: screen.getByRole("heading", {level: 2, name: "Sessions"}).className,
		}).toStrictEqual({current: ["Sessions"], tabHeading: "sr-only"});
	});

	it("gives every nav item an icon before its label", async () => {
		await renderAt("/#settings/general");

		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect(
			[...nav.querySelectorAll("button")].map((button) => button.firstElementChild?.tagName.toLowerCase()),
		).toStrictEqual(Array.from({length: 11}, () => "svg"));
	});

	it("lists one row per upstream nav row, in untitled groups, with the renamed Appearance, Customize and Code rows", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect(
			within(nav)
				.getAllByRole("list")
				.map((list) =>
					within(list)
						.getAllByRole("listitem")
						.map((item) => ({
							testId: item.getAttribute("data-testid"),
							label: item.textContent,
							selected: within(item).getByRole("button").getAttribute("aria-current"),
						})),
				),
		).toStrictEqual([
			[{testId: "usage-settings", label: "Usage", selected: null}],
			[
				{testId: "general-settings", label: "Appearance", selected: "page"},
				{testId: "notifications-settings", label: "Notifications", selected: null},
			],
			[
				{testId: "customize-connectors-settings", label: "Customize", selected: null},
				{testId: "claude-code-settings", label: "Code", selected: null},
				{testId: "transcript-settings", label: "Transcript", selected: null},
				{testId: "sessions-settings", label: "Sessions", selected: null},
			],
			[
				{testId: "application-settings", label: "Application", selected: null},
				{testId: "ai-features-settings", label: "AI features", selected: null},
				{testId: "claude-config-settings", label: "Claude Config", selected: null},
				{testId: "setup-settings", label: "Setup", selected: null},
			],
		]);
	});

	// Upstream S6: MV + pe-xs (not on a customize member) + Mc(active), an icon span and a truncating label span.
	it("draws each nav row with upstream's MV/Mc classes, pe-xs except on Customize, and a truncating label", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		const row = (name: string) => {
			const button = within(nav).getByRole("button", {name});
			return {
				classes: button.className.split(/\s+/),
				icon: button.firstElementChild
					?.getAttribute("class")
					?.split(" ")
					.filter((token) => !token.startsWith("lucide"))
					.join(" "),
				label: [button.lastElementChild?.tagName, button.lastElementChild?.className],
			};
		};
		const base = [
			"hit-row",
			"hit-row-main",
			"flex",
			"h-8",
			"w-full",
			"items-center",
			"gap-3",
			"rounded-r6",
			"px-2",
			"text-start",
			"text-body",
			"focus-visible:outline-hidden",
			"not-dark:focus-visible:shadow-[inset_0_0_0_1px_#fcfcfb,0_0_0_1px_#257de0,0_0_6px_1px_#cde2fb]",
			"dark:focus-visible:shadow-[inset_0_0_0_1px_rgb(21_21_21),0_0_0_1px_rgb(37_125_224),0_0_6px_1px_rgb(24_79_149/0.6)]",
		];
		const rest = ["text-secondary-control", "hover:bg-fill-ghost-hover", "hover:text-primary"];
		const children = {icon: "size-5 shrink-0 text-secondary-control", label: ["SPAN", "min-w-0 flex-1 truncate"]};

		expect({appearance: row("Appearance"), code: row("Code"), customize: row("Customize")}).toStrictEqual({
			appearance: {
				classes: [
					...base,
					"pe-1.5",
					"bg-fill-ghost-selected",
					"hover:layers-1-fill-ghost-hover",
					"font-medium",
					"text-primary",
				],
				...children,
			},
			code: {classes: [...base, "pe-1.5", ...rest], ...children},
			customize: {classes: [...base, ...rest], ...children},
		});
	});

	it("labels the dialog by an sr-only Settings h2 instead of aria-label, as upstream", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const heading = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
		expect({
			ariaLabel: dialog.getAttribute("aria-label"),
			heading: {tag: heading?.tagName.toLowerCase(), text: heading?.textContent, className: heading?.className},
			inside: heading !== null && dialog.contains(heading),
		}).toStrictEqual({
			ariaLabel: null,
			heading: {tag: "h2", text: "Settings", className: "sr-only"},
			inside: true,
		});
	});

	it("clears the hash on Escape", async () => {
		const router = await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.keyDown(dialog, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(location(router)).toStrictEqual({pathname: "/", hash: ""});
	});

	it("clears the hash on × and restores focus to the element focused before opening", async () => {
		const router = await renderAt("/");
		const trigger = await screen.findByRole("button", {name: "Page trigger"});
		trigger.focus();

		await act(async () => router.navigate({to: "/", hash: "settings/general"}));
		await screen.findByRole("dialog", {name: "Settings"});
		fireEvent.click(screen.getByRole("button", {name: "Close"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(trigger);
		});
		expect(location(router)).toStrictEqual({pathname: "/", hash: ""});
	});

	it("switching tabs updates the hash and aria-current", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.click(screen.getByRole("button", {name: "Transcript"}));

		await waitFor(() => {
			expect(currentTabs()).toStrictEqual(["Transcript"]);
		});
		expect(location(router)).toStrictEqual({pathname: "/", hash: "settings/transcript"});
	});

	// Upstream's SettingsNavSearch focuses its input on mount (focusVisible:false), not the trigger wrapper div.
	it("puts initial focus in the Search input, not its trigger wrapper", async () => {
		// jsdom ignores focusVisible (an input always matches :focus-visible there), so pin the option itself.
		const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const input = within(dialog).getByRole("textbox", {name: "Search settings"});

		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		expect(focus.mock.calls).toStrictEqual([[{preventScroll: true, focusVisible: false}]]);
		focus.mockRestore();
	});

	it("puts initial focus in the Search input when ⇧⌘, opens the dialog", async () => {
		await renderAt("/");
		const composer = await screen.findByRole("textbox", {name: "Page composer"});
		composer.focus();

		fireEvent.keyDown(composer, {key: "<", code: "Comma", ctrlKey: true, shiftKey: true});

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		await waitFor(() => {
			expect(document.activeElement).toBe(within(dialog).getByRole("textbox", {name: "Search settings"}));
		});
	});

	it("opens General with ⇧⌘, while a textarea has focus", async () => {
		const router = await renderAt("/");
		const composer = await screen.findByRole("textbox", {name: "Page composer"});
		composer.focus();

		// jsdom's user agent is not a Mac, so the non-mac Ctrl+Shift+, binding applies.
		fireEvent.keyDown(composer, {key: "<", code: "Comma", ctrlKey: true, shiftKey: true});

		await screen.findByRole("dialog", {name: "Settings"});
		expect({location: location(router), current: currentTabs()}).toStrictEqual({
			location: {pathname: "/", hash: "settings/general"},
			current: ["Appearance"],
		});
	});
});

describe("SettingsDialog at phone width", () => {
	beforeEach(() => {
		stubBrowser([PHONE_SHEET_QUERY, SETTINGS_PHONE_QUERY]);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("renders a horizontal tab strip under a Settings heading instead of the side nav", async () => {
		await renderAt("/#settings/transcript");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const tablist = within(dialog).getByRole("tablist", {name: "Settings"});

		expect({
			sideNav: within(dialog).queryByRole("navigation"),
			sideNavWidth: dialog.querySelector(".w-\\[212px\\]"),
			heading: within(dialog).getByRole("heading", {level: 2, name: "Settings"}).textContent,
			headingClass: within(dialog).getByRole("heading", {level: 2, name: "Settings"}).className,
			orientation: tablist.getAttribute("aria-orientation"),
			stripClasses: ["overflow-x-auto", "overscroll-x-contain"].filter((name) =>
				tablist.classList.contains(name),
			),
			tabs: within(tablist)
				.getAllByRole("tab")
				.map((tab) => ({label: tab.textContent, selected: tab.getAttribute("aria-selected")})),
			search: within(dialog).queryAllByRole("textbox", {name: "Search settings"}).length,
			scrollForward: dialog.querySelectorAll('button[aria-label="Scroll forward"]').length,
		}).toStrictEqual({
			sideNav: null,
			sideNavWidth: null,
			heading: "Settings",
			headingClass: "min-w-0 flex-1 text-[15px]/[20px] font-[520] text-primary",
			orientation: "horizontal",
			stripClasses: ["overflow-x-auto", "overscroll-x-contain"],
			tabs: [
				{label: "Usage", selected: "false"},
				{label: "Appearance", selected: "false"},
				{label: "Notifications", selected: "false"},
				{label: "Customize", selected: "false"},
				{label: "Code", selected: "false"},
				{label: "Transcript", selected: "true"},
				{label: "Sessions", selected: "false"},
				{label: "Application", selected: "false"},
				{label: "AI features", selected: "false"},
				{label: "Claude Config", selected: "false"},
				{label: "Setup", selected: "false"},
			],
			search: 0,
			scrollForward: 1,
		});
	});

	it("scrolls the phone body as upstream's Xn dialog body, scroll-fade-y included", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const body = within(dialog).getByRole("heading", {level: 2, name: "Settings"}).parentElement?.parentElement;

		expect(body?.className).toStrictEqual(`${DIALOG_BODY_CLASS} p-6`);
	});

	it("keeps the default initial focus (the first tabbable, Close) at phone width, where there is no search", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		await waitFor(() => {
			expect(document.activeElement).toBe(within(dialog).getByRole("button", {name: "Close"}));
		});
	});

	it("uses upstream's 767px breakpoint, so 640-767px gets the tab strip and no search either", async () => {
		cleanup();
		vi.unstubAllGlobals();
		stubBrowser([SETTINGS_PHONE_QUERY]);
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		expect({
			query: SETTINGS_PHONE_QUERY,
			sideNav: within(dialog).queryByRole("navigation"),
			tablists: within(dialog).getAllByRole("tablist", {name: "Settings"}).length,
			search: within(dialog).queryAllByRole("textbox", {name: "Search settings"}).length,
		}).toStrictEqual({query: "(max-width: 767px)", sideNav: null, tablists: 1, search: 0});
	});

	// Upstream's cds Tabs pager: "Scroll back" (data-toward=start) before the strip once it leaves its start,
	// "Scroll forward" (data-toward=end) until it reaches its end; each pages by the strip's client width.
	it("pages the tab strip with Scroll back and Scroll forward controls shown only when they can move", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const tablist = within(dialog).getByRole("tablist", {name: "Settings"});
		const scrollBy = vi.fn<(options: ScrollToOptions) => void>();
		Object.assign(tablist, {scrollBy});
		Object.defineProperty(tablist, "clientWidth", {configurable: true, value: 300});
		Object.defineProperty(tablist, "scrollWidth", {configurable: true, value: 900});
		const pager = (name: string) => {
			// A hidden button has no accessible name, so find it by its label attribute.
			const button = dialog.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
			return {
				toward: button?.getAttribute("data-toward"),
				hidden: button?.hidden,
				classes: ["size-8", "rounded-r6"].filter((token) => button?.classList.contains(token)),
			};
		};
		const scrollTo = (left: number) => {
			act(() => {
				Object.defineProperty(tablist, "scrollLeft", {configurable: true, value: left});
				fireEvent.scroll(tablist);
			});
		};

		scrollTo(0);
		const atStart = {back: pager("Scroll back"), forward: pager("Scroll forward")};
		scrollTo(300);
		const middle = {back: pager("Scroll back"), forward: pager("Scroll forward")};
		fireEvent.click(within(dialog).getByRole("button", {name: "Scroll back"}));
		scrollTo(600);
		const atEnd = {back: pager("Scroll back"), forward: pager("Scroll forward")};
		const order = [...(tablist.parentElement?.children ?? [])].map(
			(child) => child.getAttribute("role") ?? child.getAttribute("aria-label"),
		);

		expect({atStart, middle, atEnd, order, calls: scrollBy.mock.calls}).toStrictEqual({
			atStart: {
				back: {toward: "start", hidden: true, classes: ["size-8", "rounded-r6"]},
				forward: {toward: "end", hidden: false, classes: ["size-8", "rounded-r6"]},
			},
			middle: {
				back: {toward: "start", hidden: false, classes: ["size-8", "rounded-r6"]},
				forward: {toward: "end", hidden: false, classes: ["size-8", "rounded-r6"]},
			},
			atEnd: {
				back: {toward: "start", hidden: false, classes: ["size-8", "rounded-r6"]},
				forward: {toward: "end", hidden: true, classes: ["size-8", "rounded-r6"]},
			},
			order: ["Scroll back", "tablist", "Scroll forward"],
			calls: [[{left: -300, behavior: "smooth"}]],
		});
	});

	// Upstream's phone strip is cds Tabs (`Ct.Root` > paged scroller > `Ct.List`) with the shared tab recipe.
	it("renders the phone strip as upstream's cds Tabs with data-active and the cds tab recipe", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const tablist = within(dialog).getByRole("tablist", {name: "Settings"});
		const root = tablist.closest('[data-cds="Tabs"]');
		const paged = tablist.closest("[data-paged]");
		const recipe = [
			"before:absolute",
			"data-[active]:before:bg-fill-ghost-hover",
			"text-ink-muted",
			"font-control",
			"focus-visible:before:shadow-focus",
		];
		const dropped = ["bg-fill-control", "text-[var(--settings-muted)]"];
		const tabs = within(tablist).getAllByRole("tab");

		expect({
			pagedInRoot: paged !== null && root?.contains(paged),
			pagedClasses: ["relative", "flow-root", "min-w-0"].filter((token) => paged?.classList.contains(token)),
			active: tabs.filter((tab) => tab.getAttribute("data-active") === "").map((tab) => tab.textContent),
			recipeMissing: tabs.filter((tab) => recipe.some((token) => !tab.classList.contains(token))).length,
			droppedPresent: tabs.filter((tab) => dropped.some((token) => tab.classList.contains(token))).length,
		}).toStrictEqual({
			pagedInRoot: true,
			pagedClasses: ["relative", "flow-root", "min-w-0"],
			active: ["Appearance"],
			recipeMissing: 0,
			droppedPresent: 0,
		});
	});

	// Upstream's phone strip has one tab per nav row, carrying the row's testid; Customize stands for its sections.
	it("gives each phone tab its row's testid and selects Customize on any customize section", async () => {
		await renderAt("/#customize/plugins/yours");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const tablist = within(dialog).getByRole("tablist", {name: "Settings"});

		expect(
			within(tablist)
				.getAllByRole("tab")
				.map((tab) => [tab.getAttribute("data-testid"), tab.textContent, tab.getAttribute("aria-selected")]),
		).toStrictEqual([
			["usage-settings", "Usage", "false"],
			["general-settings", "Appearance", "false"],
			["notifications-settings", "Notifications", "false"],
			["customize-connectors-settings", "Customize", "true"],
			["claude-code-settings", "Code", "false"],
			["transcript-settings", "Transcript", "false"],
			["sessions-settings", "Sessions", "false"],
			["application-settings", "Application", "false"],
			["ai-features-settings", "AI features", "false"],
			["claude-config-settings", "Claude Config", "false"],
			["setup-settings", "Setup", "false"],
		]);
	});

	it("switches tabs from the strip through the hash", async () => {
		const router = await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.click(within(dialog).getByRole("tab", {name: "Sessions"}));

		await waitFor(() => {
			expect(location(router)).toStrictEqual({pathname: "/", hash: "settings/sessions"});
		});
		expect(within(dialog).getByRole("tab", {name: "Sessions"}).getAttribute("aria-selected")).toBe("true");
	});

	it("keeps every settings row's control column from shrinking", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const controls = [...dialog.querySelectorAll("[data-settings-control]")];

		expect({
			any: controls.length > 0,
			unshrinkable: controls.every((control) => control.classList.contains("shrink-0")),
		}).toStrictEqual({any: true, unshrinkable: true});
	});
});

describe("/settings route", () => {
	beforeEach(() => {
		stubBrowser();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("redirects to the home page with the General settings hash", async () => {
		const router = await renderAt("/settings");

		await screen.findByRole("dialog", {name: "Settings"});
		expect(location(router)).toStrictEqual({pathname: "/", hash: "settings/general"});
	});
});

describe("SettingsDialog local tabs", () => {
	// The Customize panel loads on first open. Without this, the first Skills/Plugins/Connectors test pays for
	// importing its module graph plus React's 300ms Suspense reveal throttle inside findBy's 1s window.
	beforeAll(async () => {
		await preloadCustomizeDialogPanel();
	});

	beforeEach(() => {
		stubBrowser();
		vi.stubGlobal("fetch", async () => new Promise(() => {}));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	/** Each h3 section in the open tab mapped to its row titles, in DOM order. */
	function tabOutline(dialog: HTMLElement): Array<[string, string[]]> {
		return [...dialog.querySelectorAll("section")].map((section) => [
			section.querySelector("h3")?.textContent ?? "",
			[...section.querySelectorAll<HTMLElement>("[data-settings-row]")].map((row) => {
				const titleId = row.getAttribute("aria-labelledby") ?? "";
				return row.querySelector(`[id="${titleId}"]`)?.textContent ?? "";
			}),
		]);
	}

	it.each<[string, Array<[string, string[]]>]>([
		[
			"transcript",
			[
				["Session Display", ["Thinking", "Tools", "Tool duration", "Debug"]],
				["Hooks", ["Passed hooks", "Hook warnings", "Hook errors"]],
				[
					"System Content",
					["System banners", "Show compact summaries inline", "Show transcript-only system records"],
				],
				["Link categories", []],
			],
		],
		[
			"sessions",
			[
				["Active sessions", ["Active session order", "Sessions page grouping", "Active timeout (seconds)"]],
				["Titles", ["Show AI titles"]],
				["Composer", ["Show working-copy changes strip", "Offer to review uncommitted changes"]],
				["Sub-agents", ["Default view"]],
			],
		],
		["application", [["Application", []]]],
		[
			"ai-features",
			[
				[
					"AI Features",
					[
						"Summary button",
						"Working-copy review",
						"Review behavior",
						"Session context brief",
						"Read-only MCP server",
					],
				],
			],
		],
		["claude-config", [["Claude Config", ["Claude Code settings files"]]]],
	])("renders the moved sections on the %s tab", async (tab, outline) => {
		await renderAt(`/#settings/${tab}`);
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		expect(tabOutline(dialog)).toStrictEqual(outline);
	});

	// Upstream's grouped Appearance page: "General", then the Code looks (GeneralCodeLooks) moved from Code.
	it("puts the Code looks on Appearance after General and drops them from Code", async () => {
		await renderAt("/#settings/general");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const headings = () => [...dialog.querySelectorAll("h2, h3")].map((h) => `${h.tagName}:${h.textContent}`);
		const appearance = {
			headings: headings(),
			srTitle: within(dialog).getByRole("heading", {level: 2, name: "Appearance"}).className,
			codeLooks: dialog.querySelector("#code-appearance")?.textContent.includes("Code font size"),
		};
		fireEvent.click(screen.getByRole("button", {name: "Code"}));
		await within(dialog).findByRole("heading", {level: 2, name: "Code"});

		expect({
			appearance,
			code: {
				hasCodeFont: within(dialog).queryByText("Code font") !== null,
				hasCodeAppearance: dialog.querySelector("#code-appearance") !== null,
			},
		}).toStrictEqual({
			appearance: {
				headings: ["H2:Settings", "H2:Appearance", "H3:General", "H3:Code"],
				srTitle: "sr-only",
				codeLooks: true,
			},
			code: {hasCodeFont: false, hasCodeAppearance: false},
		});
	});

	it("gives Notifications its own tab, as upstream's Notifications row", async () => {
		await renderAt("/#settings/notifications");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});

		expect({
			current: currentTabs(),
			outline: tabOutline(dialog),
		}).toStrictEqual({
			current: ["Notifications"],
			outline: [["Notifications", ["Response completions", "Code permission requests", "Notification sound"]]],
		});
	});

	it("opens Skills inside the dialog by hash with the Yours/Discover control, the Customize row current", async () => {
		const router = await renderAt("/#customize/skills/yours");

		const views = await screen.findByRole("radiogroup", {name: "Skills"});
		expect({
			location: location(router),
			current: currentTabs(),
			views: [...views.querySelectorAll('[role="radio"]')].map((radio) => [
				radio.textContent,
				radio.getAttribute("aria-checked"),
			]),
		}).toStrictEqual({
			location: {pathname: "/", hash: "customize/skills/yours"},
			current: ["Customize"],
			views: [
				["Yours", "true"],
				["Discover", "false"],
			],
		});
	});

	it("clears a non-empty Customize search on Escape without closing the dialog, and closes it on a second Escape, as upstream does", async () => {
		const router = await renderAt("/#customize/skills/yours");
		fireEvent.click(await screen.findByRole("button", {name: "Search"}));
		const input = screen.getByRole<HTMLInputElement>("searchbox", {name: "Search"});
		fireEvent.change(input, {target: {value: "gh"}});

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		const afterFirst = {
			dialog: screen.queryByRole("dialog") !== null,
			value: input.value,
			focused: document.activeElement === input,
			location: location(router),
		};

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		expect({afterFirst, afterSecond: location(router)}).toStrictEqual({
			afterFirst: {
				dialog: true,
				value: "",
				focused: true,
				location: {pathname: "/", hash: "customize/skills/yours"},
			},
			afterSecond: {pathname: "/", hash: ""},
		});
	});

	it("keeps the always-visible ≥768px Customize field on Escape: the first clears it, the second closes the dialog", async () => {
		stubBrowser([SETTINGS_WIDE_QUERY]);
		await renderAt("/#customize/skills/yours");
		const input = await screen.findByTestId<HTMLInputElement>("customize-header-search");
		fireEvent.change(input, {target: {value: "gh"}});

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		const afterFirst = {
			dialog: screen.queryByRole("dialog") !== null,
			value: input.value,
			field: screen.queryByTestId("customize-header-search") === input,
		};

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(afterFirst).toStrictEqual({dialog: true, value: "", field: true});
	});

	it("clears the Customize search when the nav switches section, as upstream does", async () => {
		stubBrowser([SETTINGS_WIDE_QUERY]);
		const router = await renderAt("/#customize/skills/yours");
		fireEvent.change(await screen.findByTestId<HTMLInputElement>("customize-header-search"), {
			target: {value: "gh"},
		});

		fireEvent.click(screen.getByRole("button", {name: "Customize"}));
		await waitFor(() => {
			expect(location(router)).toStrictEqual({pathname: "/", hash: "customize/connectors/yours"});
			expect(document.querySelector("[data-customize-dialog-pane] h2.sr-only")?.textContent).toBe("Connectors");
		});

		expect({
			inConnectors: screen.getByTestId<HTMLInputElement>("customize-header-search").value,
			unified: screen.queryByTestId("customize-unified-search-results"),
		}).toStrictEqual({inConnectors: "", unified: null});
	});

	it("opens the narrow Customize search on ⌘F inside the dialog with a fine pointer, as upstream does", async () => {
		await renderAt("/#customize/skills/yours");
		const button = await screen.findByRole("button", {name: "Search"});
		button.focus();
		fireEvent.keyDown(button, {key: "f", metaKey: true});
		const input = screen.getByRole("searchbox", {name: "Search"});

		expect({
			focused: document.activeElement === input,
			dialog: screen.queryByRole("dialog") !== null,
		}).toStrictEqual({focused: true, dialog: true});
	});

	it("leaves ⌘F to the browser on a coarse pointer", async () => {
		stubBrowser(["(pointer: coarse)"]);
		await renderAt("/#customize/skills/yours");
		const button = await screen.findByRole("button", {name: "Search"});
		button.focus();
		const event = new KeyboardEvent("keydown", {key: "f", metaKey: true, bubbles: true, cancelable: true});
		button.dispatchEvent(event);

		expect({field: screen.queryByRole("searchbox"), prevented: event.defaultPrevented}).toStrictEqual({
			field: null,
			prevented: false,
		});
	});

	it("switches a customize section to Discover through the hash", async () => {
		const router = await renderAt("/#customize/plugins/yours");
		const views = await screen.findByRole("radiogroup", {name: "Plugins"});

		fireEvent.click(within(views).getByRole("radio", {name: "Discover"}));

		await waitFor(() => {
			expect(location(router)).toStrictEqual({pathname: "/", hash: "customize/plugins"});
		});
		expect(currentTabs()).toStrictEqual(["Customize"]);
	});

	it("opens Discover for a bare #customize/<section> hash, as upstream does", async () => {
		await renderAt("/#customize/skills");
		const views = await screen.findByRole("radiogroup", {name: "Skills"});

		expect(
			[...views.querySelectorAll('[role="radio"]')].map((radio) => [
				radio.textContent,
				radio.getAttribute("aria-checked"),
			]),
		).toStrictEqual([
			["Yours", "false"],
			["Discover", "true"],
		]);
	});

	it("opens Connectors from the Customize row, replacing the entry, and ignores a click while Connectors is current", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const visited: string[] = [];
		for (let click = 0; click < 2; click++) {
			fireEvent.click(screen.getByRole("button", {name: "Customize"}));
			await screen.findByRole("heading", {level: 2, name: "Connectors"});
			visited.push(`${router.history.length}:${router.state.location.hash}`);
		}

		expect({visited, current: currentTabs()}).toStrictEqual({
			visited: ["1:customize/connectors/yours", "1:customize/connectors/yours"],
			current: ["Customize"],
		});
	});

	it("replaces another customize section with Connectors from the Customize row", async () => {
		const router = await renderAt("/#customize/plugins/yours");
		await screen.findByRole("heading", {level: 2, name: "Plugins"});

		fireEvent.click(screen.getByRole("button", {name: "Customize"}));

		await screen.findByRole("heading", {level: 2, name: "Connectors"});
		expect(`${router.history.length}:${router.state.location.hash}`).toBe("1:customize/connectors/yours");
	});

	it.each(["/#customize/bogus", "/#customize/skills/mine", "/#customize"])(
		"clears the unparseable customize hash %s, as upstream does",
		async (entry) => {
			const router = await renderAt(entry);

			await waitFor(() => {
				expect({location: location(router), length: router.history.length}).toStrictEqual({
					location: {pathname: "/", hash: ""},
					length: 1,
				});
			});
			expect(screen.queryByRole("dialog")).toBeNull();
		},
	);

	it("shows the Your skills back link above an unknown skill's not-found message", async () => {
		vi.stubGlobal("fetch", async () => Promise.resolve(Response.json({error: "not found"}, {status: 404})));
		await renderAt("/#customize/skills/yours/id/nope-skill");
		await screen.findByText("Skill not found");
		const back = screen.getByRole("link", {name: "Your skills"});

		expect({
			href: back.getAttribute("href"),
			beforeMessage:
				(back.compareDocumentPosition(screen.getByText("Skill not found")) &
					Node.DOCUMENT_POSITION_FOLLOWING) !==
				0,
		}).toStrictEqual({href: "#customize/skills/yours", beforeMessage: true});
	});

	it("opens Connectors without a Yours/Discover control", async () => {
		await renderAt("/#customize/connectors/yours");
		// The empty search sits collapsed behind its magnifier.
		await screen.findByRole("button", {name: "Search"});

		expect({current: currentTabs(), views: screen.queryByRole("radiogroup")}).toStrictEqual({
			current: ["Customize"],
			views: null,
		});
	});

	it("opens a skill's detail inside the dialog and links back by hash", async () => {
		const skill: SkillSummary = {
			id: "personal:foo",
			name: "foo",
			description: "Does foo",
			source: "personal",
			sourceLabel: "Personal",
			dir: "/home/u/.claude/skills/foo",
			mtime: 0,
			enabled: true,
		};
		const detail: SkillDetail = {
			skill,
			userInvocable: true,
			modelInvocable: true,
			allowedTools: [],
			tree: [],
		};
		const router = await renderAt("/#customize/skills/yours", (queryClient) => {
			queryClient.setQueryData(customizeSkillsQueryOptions.queryKey, [skill]);
			queryClient.setQueryData(customizeSkillDetailQueryOptions(skill.id).queryKey, detail);
		});

		fireEvent.click(await screen.findByRole("button", {name: "View foo"}));

		const sections = await screen.findByRole("navigation", {name: "Skill sections"});
		expect({
			location: location(router),
			current: currentTabs(),
			back: screen.getByRole("link", {name: "Your skills"}).getAttribute("href"),
			tabs: within(sections)
				.getAllByRole("link")
				.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")]),
		}).toStrictEqual({
			location: {pathname: "/", hash: "customize/skills/yours/id/personal%3Afoo"},
			current: ["Customize"],
			back: "#customize/skills/yours",
			tabs: [
				["Overview", "#customize/skills/yours/id/personal%3Afoo", "page"],
				["Contents · 0", "#customize/skills/yours/id/personal%3Afoo/contents", null],
			],
		});

		fireEvent.click(within(sections).getByRole("link", {name: "Contents · 0"}));

		await waitFor(() => {
			expect(location(router)).toStrictEqual({
				pathname: "/",
				hash: "customize/skills/yours/id/personal%3Afoo/contents",
			});
		});
	});

	const DETAIL_TAB =
		"relative -mb-px inline-flex h-8 shrink-0 items-center justify-center border-b-2 border-transparent px-3 text-body font-medium text-ink-muted no-underline hover:text-primary aria-[current=page]:border-primary aria-[current=page]:text-primary";

	it("fixes a skill detail's header and tabs above an inner body scroller at upstream's comfortable sizes", async () => {
		const skill: SkillSummary = {
			id: "personal:foo",
			name: "foo",
			description: "Does foo",
			source: "personal",
			sourceLabel: "Personal",
			dir: "/home/u/.claude/skills/foo",
			mtime: 0,
			enabled: true,
		};
		const detail: SkillDetail = {
			skill,
			userInvocable: true,
			modelInvocable: true,
			allowedTools: [],
			tree: [],
		};
		await renderAt("/#customize/skills/yours/id/personal%3Afoo", (queryClient) => {
			queryClient.setQueryData(customizeSkillsQueryOptions.queryKey, [skill]);
			queryClient.setQueryData(customizeSkillDetailQueryOptions(skill.id).queryKey, detail);
		});
		const sections = await screen.findByRole("navigation", {name: "Skill sections"});
		const dialog = screen.getByRole("dialog", {name: "Settings"});
		const pane = dialog.querySelector<HTMLElement>("[data-customize-dialog-pane]");
		const root = pane?.children[2]?.firstElementChild?.firstElementChild;
		const [fixed, scroller] = [...(root?.children ?? [])];
		const fixedColumn = fixed?.firstElementChild;
		const inset = fixedColumn?.firstElementChild;
		const header = inset?.firstElementChild ?? null;
		const column = scroller?.firstElementChild;
		const h2 = screen.getByRole("heading", {level: 2, name: "foo"});
		const description = screen.getByRole("heading", {level: 3, name: "Description"});
		const [overview, contents] = within(sections).getAllByRole("link");

		expect({
			root: [root?.className, root?.children.length],
			fixed: fixed?.className,
			fixedColumn: fixedColumn?.className,
			inset: inset?.className,
			header: [header?.tagName, header?.className],
			scroller: scroller?.className,
			column: column?.className,
			inset2: column?.firstElementChild?.className,
			headerInScroller: scroller?.contains(header),
			tabsFixed: fixed?.contains(sections),
			descriptionInScroller: scroller?.contains(description),
			h2: h2.className,
			meta: h2.nextElementSibling?.className,
			tile: header?.querySelector("[data-testid=customize-icon-tile]")?.className,
			tabsScroller: sections.parentElement?.className,
			nav: sections.className,
			overview: [overview?.className, overview?.getAttribute("aria-current")],
			contents: [contents?.className, contents?.querySelector("span span")?.className],
			description: description.className,
		}).toStrictEqual({
			root: ["flex h-full min-h-0 flex-col", 2],
			fixed: "shrink-0",
			fixedColumn: "mx-auto w-full max-w-5xl md:px-2 flex flex-col pt-3",
			inset: "px-6",
			header: ["HEADER", "flex flex-col gap-4"],
			scroller: "flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y pt-6 pb-6",
			column: "mx-auto w-full max-w-5xl md:px-2 flex flex-1 flex-col",
			inset2: "px-6 flex flex-1 flex-col",
			headerInScroller: false,
			tabsFixed: true,
			descriptionInScroller: true,
			h2: "m-0 min-w-0 truncate text-[15px]/[20px] font-[580] text-primary",
			meta: "m-0 break-words text-footnote text-muted-as-secondary",
			tile: "flex shrink-0 items-center justify-center border border-border bg-surface-0 text-muted-as-secondary size-11 rounded-card",
			tabsScroller: "-m-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
			nav: "flex w-max min-w-full items-end gap-[2px] border-b border-border",
			overview: [DETAIL_TAB, "page"],
			contents: [DETAIL_TAB, "text-muted-as-secondary"],
			description: "m-0 text-caption text-secondary",
		});
	});

	it("gives the Customize panel upstream's own chrome: an empty chrome slot, crumb bar, fixed title header and an inner list scroller", async () => {
		const skill: SkillSummary = {
			id: "personal:foo",
			name: "foo",
			description: "Does foo",
			source: "personal",
			sourceLabel: "Personal",
			dir: "/home/u/.claude/skills/foo",
			mtime: 0,
			enabled: true,
		};
		await renderAt("/#customize/skills/yours", (queryClient) => {
			queryClient.setQueryData(customizeSkillsQueryOptions.queryKey, [skill]);
		});
		const row = await screen.findByRole("button", {name: "View foo"});
		const dialog = screen.getByRole("dialog", {name: "Settings"});
		const pane = dialog.querySelector<HTMLElement>("[data-customize-dialog-pane]");
		const [chrome, crumbBar, body] = [...(pane?.children ?? [])];
		const frame = body?.firstElementChild?.firstElementChild;
		const [srTitle, header, spacer, scroller] = [...(frame?.children ?? [])];
		const [titleGroup, controls] = [...(header?.children ?? [])];

		expect({
			pane: pane?.className,
			paneChildren: pane?.children.length,
			chrome: [chrome?.getAttribute("data-customize-dialog-chrome"), chrome?.className],
			chromeChildren: chrome?.childElementCount,
			closes: within(dialog).getAllByRole("button", {name: "Close"}).length,
			crumbBar: [crumbBar?.getAttribute("data-testid"), crumbBar?.className, crumbBar?.innerHTML],
			body: body?.className,
			clip: body?.firstElementChild?.className,
			frame: frame?.className,
			header: [header?.tagName, header?.className],
			titleGroup: titleGroup?.className,
			srTitle: srTitle?.outerHTML,
			tablist: [...(titleGroup?.querySelectorAll('[role="tablist"]') ?? [])].map((list) => [
				list.getAttribute("aria-label"),
				list.className,
				[...list.querySelectorAll('[role="tab"]')].map((tab) => [
					tab.textContent,
					tab.getAttribute("aria-selected"),
					tab.getAttribute("tabindex"),
				]),
			]),
			visibleTitle: dialog.querySelector("h2:not(.sr-only):not([id])"),
			controls: controls?.className,
			spacer: [spacer?.getAttribute("aria-hidden"), spacer?.className],
			scroller: scroller?.className,
			column: scroller?.firstElementChild?.className,
			rowInScroller: scroller?.contains(row),
			headerInScroller: scroller?.contains(header ?? null),
			sharedHeaderRow: dialog.querySelector(".justify-between.px-3.pt-3.pb-2"),
			sharedScroller: dialog.querySelector(".space-y-6.overflow-y-auto"),
		}).toStrictEqual({
			pane: "relative flex min-h-0 flex-1 flex-col",
			paneChildren: 3,
			chrome: ["", "contents"],
			chromeChildren: 0,
			closes: 1,
			crumbBar: [
				"customize-dialog-crumb-bar",
				"flex shrink-0 items-center pt-3 pb-2 ps-5 pe-4 has-[>:empty]:pb-0 max-md:has-[>:empty]:hidden [&>:empty]:hidden",
				'<div class="min-h-8 relative flex min-w-0 flex-1 items-center gap-6"></div>',
			],
			body: "relative flex min-h-0 flex-1 flex-col",
			clip: "relative min-h-0 flex-1 overflow-x-hidden overflow-y-hidden",
			frame: "flex h-full min-h-0 flex-1 flex-col pt-1",
			header: [
				"HEADER",
				"mx-auto w-full max-w-4xl px-5 flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-3 max-md:pt-3",
			],
			titleGroup: "flex min-w-0 items-center gap-4",
			srTitle: '<h2 class="sr-only">Skills</h2>',
			tablist: [
				[
					"Customize",
					"flex items-center font-sans [&>[role=tab]:first-child]:before:start-0 [&>[role=tab]:last-child]:before:end-0 -ms-3",
					[
						["Connectors", "false", "-1"],
						["Skills", "true", "0"],
						["Plugins", "false", "-1"],
					],
				],
			],
			visibleTitle: null,
			controls: "ms-auto flex min-w-0 items-center justify-end gap-2",
			spacer: ["true", "shrink-0 h-4"],
			scroller: "relative -mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto pb-4 pt-1",
			column: "mx-auto w-full max-w-4xl px-5 flex flex-1 flex-col",
			rowInScroller: true,
			headerInScroller: false,
			sharedHeaderRow: null,
			sharedScroller: null,
		});
	});

	it("names each Customize section's panel with an sr-only h2 and selects its header tab", async () => {
		await renderAt("/#customize/plugins/yours");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const shown = () => {
			const tabs = within(dialog).getByRole("tablist", {name: "Customize"});
			return {
				heading: dialog.querySelector("[data-customize-dialog-pane] h2")?.textContent,
				selected: within(tabs)
					.getAllByRole("tab")
					.filter((tab) => tab.getAttribute("aria-selected") === "true")
					.map((tab) => tab.textContent),
			};
		};
		await waitFor(() => {
			expect(shown()).toStrictEqual({heading: "Plugins", selected: ["Plugins"]});
		});
		fireEvent.click(screen.getByRole("button", {name: "Customize"}));
		await waitFor(() => {
			expect(shown()).toStrictEqual({heading: "Connectors", selected: ["Connectors"]});
		});
	});

	// Upstream's header tabs replace the hash with the bare section (#customize/skills) and keep the Customize row current.
	it("switches Customize sections from the header tabs, replacing the entry, with the Customize row still current", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		fireEvent.click(screen.getByRole("button", {name: "Customize"}));
		const tabs = await screen.findByRole("tablist", {name: "Customize"});

		fireEvent.click(within(tabs).getByRole("tab", {name: "Skills"}));

		await screen.findByRole("heading", {level: 2, name: "Skills"});
		expect({
			entry: `${router.history.length}:${router.state.location.hash}`,
			current: currentTabs(),
		}).toStrictEqual({entry: "1:customize/skills", current: ["Customize"]});
	});

	it("moves focus between the Customize header tabs with the arrow keys", async () => {
		await renderAt("/#customize/connectors/yours");
		const tabs = await screen.findByRole("tablist", {name: "Customize"});
		const [connectors, skills, plugins] = ["Connectors", "Skills", "Plugins"].map((name) =>
			within(tabs).getByRole("tab", {name}),
		);

		connectors?.focus();
		fireEvent.keyDown(within(tabs).getByRole("tab", {name: "Connectors"}), {key: "ArrowRight"});
		const afterRight = document.activeElement;
		fireEvent.keyDown(within(tabs).getByRole("tab", {name: "Skills"}), {key: "ArrowLeft"});
		const afterLeft = document.activeElement;
		fireEvent.keyDown(within(tabs).getByRole("tab", {name: "Connectors"}), {key: "ArrowLeft"});

		expect([afterRight, afterLeft, document.activeElement]).toStrictEqual([skills, connectors, plugins]);
	});

	it("closes the dialog from the top row's Close button while a Customize section is open", async () => {
		const router = await renderAt("/#customize/skills/yours");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const close = await waitFor(() => {
			const button = dialog.querySelector<HTMLButtonElement>(
				'[data-testid="settings-top-row"] button[aria-label=Close]',
			);
			if (button === null) throw new Error("Customize Close button not rendered yet");
			return button;
		});
		fireEvent.click(close);
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(location(router)).toStrictEqual({pathname: "/", hash: ""});
	});

	it("links the Claude Config tab to the settings editor", async () => {
		await renderAt("/#settings/claude-config");
		await screen.findByRole("dialog", {name: "Settings"});

		expect(screen.getByRole("link", {name: "Open editor"}).getAttribute("href")).toBe("/settings/edit");
	});

	it("embeds the hook setup on the Setup tab", async () => {
		await renderAt("/#settings/setup");
		await screen.findByRole("dialog", {name: "Settings"});

		// "Settings" is the dialog's sr-only h2 label.
		expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toStrictEqual([
			"Settings",
			"Setup",
			"Hook Configuration",
		]);
	});
});
