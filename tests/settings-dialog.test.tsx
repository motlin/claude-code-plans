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
import {PHONE_SHEET_QUERY, SETTINGS_PHONE_QUERY} from "../src/lib/use-phone-sheet";
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

	// Locks today's comfortable shell spacing: the Settings dialog is comfortable for every web user
	// (density-default-tokens), so upstream's px-xl / pb-lg / pt-md resolve to 24 / 16 / 12px.
	it("keeps the comfortable shell spacing", async () => {
		await renderAt("/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const nav = within(dialog).getByRole("navigation", {name: "Settings"});
		const close = within(dialog).getByRole("button", {name: "Close"});
		const header = close.parentElement;
		const scroll = header?.nextElementSibling ?? null;
		const pick = (element: Element | null, names: string[]) =>
			names.filter((name) => element?.classList.contains(name));

		expect({
			nav: pick(nav, ["w-48", "gap-3"]),
			header: pick(header ?? null, ["px-3", "pt-3", "pb-2"]),
			scroll: pick(scroll, ["px-6", "pt-2", "pb-4"]),
		}).toStrictEqual({
			nav: ["w-48", "gap-3"],
			header: ["px-3", "pt-3", "pb-2"],
			scroll: ["px-6", "pt-2", "pb-4"],
		});
	});

	// Upstream's panel header has an empty left title slot before Close, and the scroll container
	// starts with a sticky fade in the popup's surface colour so rows don't cut hard under the header.
	// Spacing stays comfortable (density-default-tokens): px-xl / gap-md resolve to 24 / 12px.
	it("renders the panel header title slot and the scroll top fade", async () => {
		await renderAt("/#settings/general");

		const dialog = await screen.findByRole("dialog", {name: "Settings"});
		const close = within(dialog).getByRole("button", {name: "Close"});
		const header = close.parentElement;
		const scroll = header?.nextElementSibling ?? null;
		const fade = scroll?.firstElementChild ?? null;

		expect({
			header: header?.className,
			headerChildren: [...(header?.children ?? [])].map((child) => ({
				className: child.className,
				childCount: child.childElementCount,
				text: child.textContent,
			})),
			fade: {
				ariaHidden: fade?.getAttribute("aria-hidden"),
				className: fade?.className,
				childCount: fade?.childElementCount,
			},
		}).toStrictEqual({
			header: "flex shrink-0 items-center justify-between gap-3 px-3 pt-3 pb-2",
			headerChildren: [
				{className: "flex min-w-0 flex-1 items-center", childCount: 0, text: ""},
				{className: close.className, childCount: 1, text: ""},
			],
			fade: {
				ariaHidden: "true",
				className:
					"pointer-events-none sticky -top-2 z-[1] -mx-6 -mt-2 mb-0! h-2 bg-gradient-to-b from-[var(--menu-bg)] to-transparent dark:from-surface-2",
				childCount: 0,
			},
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

	it("lists every navigation item once in a ul labelled by its Settings or Customize heading, as upstream", async () => {
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
				label: {tag: "div", text: "Settings"},
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
			"not-dark:focus-visible:shadow-[inset_0_0_0_1px_#fcfcfb,0_0_0_1px_#2a78d6,0_0_6px_1px_#cde2fb]",
			"dark:focus-visible:shadow-[inset_0_0_0_1px_rgb(21_21_21),0_0_0_1px_rgb(42_120_214),0_0_6px_1px_rgb(24_79_149/0.6)]",
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
			w48: dialog.querySelector(".w-48"),
			heading: within(dialog).getByRole("heading", {level: 2}).textContent,
			orientation: tablist.getAttribute("aria-orientation"),
			stripClasses: ["overflow-x-auto", "overscroll-x-contain"].filter((name) =>
				tablist.classList.contains(name),
			),
			tabs: within(tablist)
				.getAllByRole("tab")
				.map((tab) => ({label: tab.textContent, selected: tab.getAttribute("aria-selected")})),
			search: within(dialog).queryAllByRole("textbox", {name: "Search settings"}).length,
			scrollForward: within(dialog).getAllByRole("button", {name: "Scroll forward"}).length,
		}).toStrictEqual({
			sideNav: null,
			w48: null,
			heading: "Settings",
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
		const input = screen.getByTestId<HTMLInputElement>("customize-header-search");
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

	it("switches a customize section to Discover through the hash", async () => {
		const router = await renderAt("/#customize/plugins/yours");
		const views = await screen.findByRole("radiogroup", {name: "Plugins"});

		fireEvent.click(within(views).getByRole("radio", {name: "Discover"}));

		await waitFor(() => {
			expect(location(router)).toStrictEqual({pathname: "/", hash: "customize/plugins/discover"});
		});
		expect(currentTabs()).toStrictEqual(["Plugins"]);
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
