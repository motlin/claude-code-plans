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

	// Upstream's nav column: w-53 (212px) with the fizzy-lake seam, px-lg/pt-lg search, and the list's
	// [&>.text-caption]:px-0 pulling the group labels flush; the first group is "Preferences".
	it("sizes the nav column, search wrapper, list and group labels like upstream", async () => {
		await renderAt("/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const nav = within(dialog).getByRole("navigation", {name: "Settings"});
		const search = within(nav).getByRole("textbox", {name: "Search settings"});
		const searchWrap = [...nav.children].find((child) => child.contains(search));
		const lists = within(nav).getAllByRole("list");
		const listWrap = lists[0]?.parentElement?.parentElement;
		const labels = lists.map((list) => document.getElementById(list.getAttribute("aria-labelledby") ?? ""));

		expect({
			nav: nav.className,
			searchWrap: searchWrap?.className,
			list: listWrap?.className,
			labels: labels.map((label) => [label?.textContent, label?.className]),
		}).toStrictEqual({
			nav: "row-start-2 flex w-[212px] min-h-0 shrink-0 flex-col border-e border-[rgb(0_0_0/0.1)] dark:border-white/10 bg-surface-1",
			searchWrap: "shrink-0 px-4 pt-4",
			list: "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4",
			labels: [
				["Preferences", "px-0 pt-3 text-[12px]/[17px] text-ink-muted"],
				["Customize", "px-0 pt-3 text-[12px]/[17px] text-ink-muted"],
			],
		});
	});

	it("opens on the hash's tab with that tab marked current", async () => {
		await renderAt("/#settings/sessions");

		await screen.findByRole("dialog", {name: "Settings"});
		// Upstream drops the per-tab h2: the content starts with the section headings.
		expect({
			current: currentTabs(),
			tabHeading: screen.queryByRole("heading", {level: 2, name: "Sessions"}),
		}).toStrictEqual({current: ["Sessions"], tabHeading: null});
	});

	it("gives every nav item an icon before its label", async () => {
		await renderAt("/#settings/general");

		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect(
			[...nav.querySelectorAll("button")].map((button) => button.firstElementChild?.tagName.toLowerCase()),
		).toStrictEqual(Array.from({length: 12}, () => "svg"));
	});

	it("lists every navigation item once in a ul labelled by its Preferences or Customize heading, as upstream", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		expect(
			within(nav)
				.getAllByRole("list")
				.map((list) => {
					const labelId = list.getAttribute("aria-labelledby") ?? "";
					const label = document.getElementById(labelId);
					return {
						name: within(nav).getByRole("list", {name: label?.textContent ?? ""}) === list,
						label: {tag: label?.tagName.toLowerCase(), text: label?.textContent},
						className: list.className,
						items: within(list)
							.getAllByRole("listitem")
							.map((item) => ({
								testId: item.getAttribute("data-testid"),
								label: item.textContent,
								selected: within(item).getByRole("button").getAttribute("aria-current"),
							})),
					};
				}),
		).toStrictEqual([
			{
				name: true,
				label: {tag: "div", text: "Preferences"},
				className: "flex flex-col gap-px",
				items: [
					{testId: "general-settings", label: "General", selected: "page"},
					{testId: "usage-settings", label: "Usage", selected: null},
					{testId: "claude-code-settings", label: "Claude Code", selected: null},
					{testId: "transcript-settings", label: "Transcript", selected: null},
					{testId: "sessions-settings", label: "Sessions", selected: null},
					{testId: "application-settings", label: "Application", selected: null},
					{testId: "ai-features-settings", label: "AI features", selected: null},
					{testId: "claude-config-settings", label: "Claude Config", selected: null},
					{testId: "setup-settings", label: "Setup", selected: null},
				],
			},
			{
				name: true,
				label: {tag: "div", text: "Customize"},
				className: "flex flex-col gap-px",
				items: [
					{testId: "customize-skills-settings", label: "Skills", selected: null},
					{testId: "customize-connectors-settings", label: "Connectors", selected: null},
					{testId: "customize-plugins-settings", label: "Plugins", selected: null},
				],
			},
		]);
	});

	it("brightens nav item text on hover and draws upstream's shadow-focus ring on keyboard focus", async () => {
		await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const nav = screen.getByRole("navigation", {name: "Settings"});
		const classes = (name: string) =>
			within(nav)
				.getByRole("button", {name})
				.className.split(/\s+/)
				.filter((token) => /hover:|focus-visible:/.test(token));
		const expected = [
			"focus-visible:outline-hidden",
			"not-dark:focus-visible:shadow-[inset_0_0_0_1px_#fcfcfb,0_0_0_1px_#257de0,0_0_6px_1px_#cde2fb]",
			"dark:focus-visible:shadow-[inset_0_0_0_1px_rgb(21_21_21),0_0_0_1px_rgb(37_125_224),0_0_6px_1px_rgb(24_79_149/0.6)]",
		];
		expect({selected: classes("General"), rest: classes("Usage")}).toStrictEqual({
			selected: expected,
			rest: [...expected, "hover:bg-fill-ghost-hover", "hover:text-primary"],
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
			current: ["General"],
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
			heading: within(dialog).getByRole("heading", {level: 2}).textContent,
			headingClass: within(dialog).getByRole("heading", {level: 2}).className,
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
				{label: "General", selected: "false"},
				{label: "Usage", selected: "false"},
				{label: "Claude Code", selected: "false"},
				{label: "Skills", selected: "false"},
				{label: "Connectors", selected: "false"},
				{label: "Plugins", selected: "false"},
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

	it("opens Skills inside the dialog by hash with the Yours/Discover control", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});

		fireEvent.click(screen.getByRole("button", {name: "Skills"}));

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
			current: ["Skills"],
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

		fireEvent.click(screen.getByRole("button", {name: "Connectors"}));
		await waitFor(() => {
			expect(location(router)).toStrictEqual({pathname: "/", hash: "customize/connectors/yours"});
			expect(document.querySelector("[data-customize-dialog-pane] header h2")?.textContent).toBe("Connectors");
		});
		const inConnectors = screen.getByTestId<HTMLInputElement>("customize-header-search").value;

		fireEvent.click(screen.getByRole("button", {name: "Skills"}));
		await waitFor(() => {
			expect(location(router)).toStrictEqual({pathname: "/", hash: "customize/skills/yours"});
			expect(document.querySelector("[data-customize-dialog-pane] header h2")?.textContent).toBe("Skills");
		});

		expect({
			inConnectors,
			backInSkills: screen.getByTestId<HTMLInputElement>("customize-header-search").value,
			unified: screen.queryByTestId("customize-unified-search-results"),
		}).toStrictEqual({inConnectors: "", backInSkills: "", unified: null});
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
		expect(currentTabs()).toStrictEqual(["Plugins"]);
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

	it("replaces the entry going from a Settings tab to a customize section, then pushes between sections", async () => {
		const router = await renderAt("/#settings/general");
		await screen.findByRole("dialog", {name: "Settings"});
		const visited: string[] = [];
		for (const name of ["Skills", "Connectors", "Plugins"]) {
			fireEvent.click(screen.getByRole("button", {name}));
			await screen.findByRole("heading", {level: 2, name});
			visited.push(`${router.history.length}:${router.state.location.hash}`);
		}
		router.history.back();
		await waitFor(() => {
			expect(router.state.location.hash).toBe("customize/connectors/yours");
		});

		expect(visited).toStrictEqual([
			"1:customize/skills/yours",
			"2:customize/connectors/yours",
			"3:customize/plugins/yours",
		]);
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
			current: ["Connectors"],
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
			current: ["Skills"],
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
			scroller: "flex min-h-0 flex-1 flex-col overflow-y-auto pt-6 pb-6",
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
		const [header, spacer, scroller] = [...(frame?.children ?? [])];
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
			title: titleGroup?.firstElementChild?.outerHTML,
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
			title: '<h2 class="min-w-0 truncate text-[22px]/[28px] font-[580] text-primary">Skills</h2>',
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

	it("titles each Customize section's panel header after the section", async () => {
		await renderAt("/#customize/connectors/yours");
		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		await waitFor(() => {
			expect(dialog.querySelector("[data-customize-dialog-pane] header h2")?.textContent).toBe("Connectors");
		});
		fireEvent.click(screen.getByRole("button", {name: "Plugins"}));
		await waitFor(() => {
			expect(dialog.querySelector("[data-customize-dialog-pane] header h2")?.textContent).toBe("Plugins");
		});
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
			"Hook Configuration",
		]);
	});
});
