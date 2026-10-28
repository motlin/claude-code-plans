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
import {useState} from "react";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {actAndSettle} from "./act-and-settle";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import CustomizeDialogPanel from "../src/components/customize/customize-dialog-panel";
import {SkillDetailHeader} from "../src/components/customize/skill-detail";
import type {UnifiedHit} from "../src/components/customize/unified-search";
import {UnifiedSearchResults} from "../src/components/customize/unified-search-results";
import {ToastProvider} from "../src/components/toast";
import {
	customizeClaudeAiConnectorsQueryOptions,
	customizeDiscoverQueryOptions,
	customizeMcpServersQueryOptions,
	customizeSkillDetailQueryOptions,
	customizeSkillsQueryOptions,
	type DiscoverCatalog,
	type McpServerSummary,
	type SkillDetail,
	type SkillSummary,
} from "../src/lib/api/customize";
import {pluginsQueryOptions, userCommandsQueryOptions} from "../src/lib/api/plugins";
import {parseCustomizeHash} from "../src/lib/settings-hash";
import {Route as CustomizeLayoutRoute} from "../src/routes/customize";
import {Route as CustomizeConnectorsRoute} from "../src/routes/customize.connectors";
import {Route as CustomizePluginsRoute} from "../src/routes/customize.plugins";
import {Route as CustomizeSkillsRoute} from "../src/routes/customize.skills";
import {startClaudeSession} from "../src/lib/start-claude-session";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/lib/start-claude-session", () => ({
	startClaudeSession: vi.fn<typeof import("../src/lib/start-claude-session").startClaudeSession>(async () =>
		Promise.resolve("launched"),
	),
}));

beforeEach(() => {
	installLocalStorage();
	vi.mocked(startClaudeSession).mockClear();
});

afterEach(() => {
	cleanup();
});

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

const SKILLS: SkillSummary[] = [
	{
		id: "personal:deploy-checklist",
		name: "deploy-checklist",
		description: "Walk the release checklist before shipping.",
		source: "personal",
		sourceLabel: "Personal",
		dir: "/Users/test/.claude/skills/deploy-checklist",
		mtime: Date.parse("2026-09-15T12:00:00Z"),
		enabled: true,
	},
];

const EXTRA_SKILLS: SkillSummary[] = [
	{
		id: "project:-Users-test-web:lint",
		name: "lint",
		description: "Lint the web app.",
		source: "project",
		sourceLabel: "web",
		dir: "/Users/test/web/.claude/skills/lint",
		mtime: Date.parse("2026-09-20T12:00:00Z"),
		enabled: true,
	},
	{
		id: "plugin:document-skills@anthropic:pdf",
		name: "pdf",
		description: "Read and write PDFs.",
		source: "plugin",
		sourceLabel: "document-skills",
		dir: "/Users/test/.claude/plugins/cache/document-skills/skills/pdf",
		mtime: Date.parse("2026-09-10T12:00:00Z"),
		enabled: true,
	},
];

const MCP_SERVERS: McpServerSummary[] = [
	{
		id: "user:github",
		name: "github",
		scope: "user",
		transport: "stdio",
		urlOrCommand: "npx github-mcp",
		enabled: true,
		envKeys: [],
		headerKeys: [],
		needsAuth: false,
	},
];

function component<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`Expected the ${name} route component`);
	return value;
}

const DISCOVER: DiscoverCatalog = {
	fetchedAt: "2026-08-31T12:09:45.226Z",
	plugins: [
		{
			id: "deploy@claude-plugins-official",
			name: "deploy",
			title: "Deploy",
			marketplace: "claude-plugins-official",
			description: "Ship safely.",
			author: "Anthropic",
			category: "deployment",
			installs: 8_340_370,
			lastUpdated: "2026-09-20T10:00:00Z",
			skills: ["deploy-checklist"],
			installed: false,
		},
		{
			id: "tidy@community",
			name: "tidy",
			title: "tidy",
			marketplace: "community",
			description: "Tidy up the deploy scripts.",
			author: null,
			category: null,
			installs: null,
			lastUpdated: null,
			skills: [],
			installed: true,
		},
	],
};

async function renderCustomize(initialEntry: string, skills: SkillSummary[] = SKILLS) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(customizeSkillsQueryOptions.queryKey, skills);
	queryClient.setQueryData(customizeDiscoverQueryOptions.queryKey, DISCOVER);
	queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, MCP_SERVERS);
	queryClient.setQueryData(pluginsQueryOptions.queryKey, []);

	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const layoutRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "customize",
		component: component(CustomizeLayoutRoute.options.component, "customize"),
		validateSearch: CustomizeLayoutRoute.options.validateSearch,
	});
	const skillsRoute = createRoute({
		getParentRoute: () => layoutRoute,
		path: "skills",
		component: component(CustomizeSkillsRoute.options.component, "skills"),
	});
	const connectorsRoute = createRoute({
		getParentRoute: () => layoutRoute,
		path: "connectors",
		component: component(CustomizeConnectorsRoute.options.component, "connectors"),
	});
	const pluginsRoute = createRoute({
		getParentRoute: () => layoutRoute,
		path: "plugins",
		component: component(CustomizePluginsRoute.options.component, "plugins"),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([layoutRoute.addChildren([skillsRoute, connectorsRoute, pluginsRoute])]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByRole("heading", {level: 1, name: "Customize"});
	return router;
}

function sectionTabs() {
	const tablist = screen.getByRole("tablist", {name: "Customize sections"});
	return within(tablist)
		.getAllByRole("tab")
		.map((tab) => ({
			name: tab.textContent,
			selected: tab.getAttribute("aria-selected"),
		}));
}

/** Expands the collapsed Customize search and returns its field. */
function openSearch(): HTMLInputElement {
	fireEvent.click(screen.getByRole("button", {name: "Search"}));
	return screen.getByRole("searchbox");
}

describe("customize shell", () => {
	it("marks the active section tab and switches sections through the URL", async () => {
		const router = await renderCustomize("/customize/skills");

		expect(sectionTabs()).toStrictEqual([
			{name: "Skills", selected: "true"},
			{name: "Connectors", selected: "false"},
			{name: "Plugins", selected: "false"},
		]);
		expect(screen.getByRole("radiogroup", {name: "Skills"})).toBeTruthy();

		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("tab", {name: "Connectors"}));
		});

		expect({
			pathname: router.state.location.pathname,
			tabs: sectionTabs(),
			segmented: screen.queryByRole("radiogroup", {name: "Connectors"}),
			placeholder: openSearch().getAttribute("placeholder"),
		}).toStrictEqual({
			pathname: "/customize/connectors",
			tabs: [
				{name: "Skills", selected: "false"},
				{name: "Connectors", selected: "true"},
				{name: "Plugins", selected: "false"},
			],
			segmented: null,
			placeholder: "Search connectors",
		});
	});

	it("switches between Yours and Discover through the view search param", async () => {
		const router = await renderCustomize("/customize/skills");
		const group = screen.getByRole("radiogroup", {name: "Skills"});

		await actAndSettle(() => {
			fireEvent.click(within(group).getByRole("radio", {name: "Discover"}));
		});

		expect({
			search: router.state.location.searchStr,
			checked: within(group)
				.getAllByRole("radio")
				.map((radio) => [radio.textContent, radio.getAttribute("aria-checked")]),
		}).toStrictEqual({
			search: "?view=discover",
			checked: [
				["Yours", "false"],
				["Discover", "true"],
			],
		});
	});

	it("lays the page out on upstream's padded column with a 'Search' placeholder and a + Add button", async () => {
		await renderCustomize("/customize/skills");
		const page = screen.getByTestId("customize-page");
		const add = screen.getByRole("button", {name: "Add skill"});
		expect({
			column: page.firstElementChild?.className.split(" ").filter((name) => /^(md:)?p[xt]-/.test(name)),
			pane: page
				.querySelector("#customize-pane")
				?.className.split(" ")
				.filter((name) => /^(md:)?px-/.test(name)),
			placeholder: openSearch().getAttribute("placeholder"),
			addIcons: [...add.querySelectorAll("svg")].map((svg) =>
				svg
					.getAttribute("class")
					?.split(" ")
					.find((name) => name.startsWith("lucide-")),
			),
			addLabelAfterPlus: add.firstElementChild?.tagName.toLowerCase(),
		}).toStrictEqual({
			column: ["px-4", "pt-12", "md:px-8"],
			pane: ["px-4", "md:px-8"],
			placeholder: "Search",
			addIcons: ["lucide-plus", "lucide-chevron-down"],
			addLabelAfterPlus: "svg",
		});
	});

	it("pins the crumb band and header above the scrolling list, as upstream's sticky customize-crumb-bar and PageHeader do", async () => {
		await renderCustomize("/customize/skills");
		const header = screen.getByTestId("customize-page").firstElementChild;
		const controls = header?.querySelector("[data-customize-controls]");
		expect({
			header: header?.className.split(" ").filter((name) => /^(sm:)?(sticky|top-|z-|-?mt-|pt-|bg-)/.test(name)),
			controlsGap: controls?.className.split(" ").filter((name) => name.startsWith("gap-")),
		}).toStrictEqual({
			header: ["sticky", "top-0", "z-10", "-mt-12", "bg-surface-1", "pt-12", "sm:-mt-9"],
			controlsGap: ["gap-2"],
		});
	});

	it("collapses an empty search to upstream's magnifier button, which expands the field inline", async () => {
		await renderCustomize("/customize/skills");
		const collapsed = {
			button: screen.queryByRole("button", {name: "Search"}) !== null,
			field: screen.queryByRole("searchbox") !== null,
		};
		const input = openSearch();
		const expanded = {
			focused: document.activeElement === input,
			width: input.closest("[role=search]")?.className.split(" ").includes("max-w-64"),
			button: screen.queryByRole("button", {name: "Search"}) !== null,
		};
		fireEvent.change(input, {target: {value: "deploy"}});
		fireEvent.keyDown(input, {key: "Escape"});
		const afterFirstEscape = {value: screen.getByRole<HTMLInputElement>("searchbox").value};
		fireEvent.keyDown(screen.getByRole("searchbox"), {key: "Escape"});
		expect({
			collapsed,
			expanded,
			afterFirstEscape,
			afterSecondEscape: {
				field: screen.queryByRole("searchbox") !== null,
				focusedButton: document.activeElement === screen.getByRole("button", {name: "Search"}),
			},
		}).toStrictEqual({
			collapsed: {button: true, field: false},
			expanded: {focused: true, width: true, button: false},
			afterFirstEscape: {value: ""},
			afterSecondEscape: {field: false, focusedButton: true},
		});
	});

	it("labels the open field Search with an always-shown Clear search, and opens it on / outside a field, as upstream does", async () => {
		await renderCustomize("/customize/skills");
		fireEvent.keyDown(document.body, {key: "/"});
		const input = screen.getByRole("searchbox", {name: "Search"});
		expect({
			focused: document.activeElement === input,
			clear: screen.queryByRole("button", {name: "Clear search"}) !== null,
		}).toStrictEqual({focused: true, clear: true});

		fireEvent.click(screen.getByRole("button", {name: "Clear search"}));
		expect({
			collapsed: screen.queryByRole("searchbox") === null,
			focusedButton: document.activeElement === screen.getByRole("button", {name: "Search"}),
		}).toStrictEqual({collapsed: true, focusedButton: true});
	});

	it("keeps a held search term's field open, and Clear search collapses it back to the magnifier", async () => {
		await renderCustomize("/customize/skills?q=deploy");
		expect(screen.getByRole("searchbox")).toHaveProperty("value", "deploy");
		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("button", {name: "Clear search"}));
		});
		expect({
			field: screen.queryByRole("searchbox") !== null,
			focusedButton: document.activeElement === screen.getByRole("button", {name: "Search"}),
		}).toStrictEqual({field: false, focusedButton: true});
	});

	it("round-trips the search term through ?q=", async () => {
		const router = await renderCustomize("/customize/skills?q=deploy");
		const input = screen.getByRole("searchbox", {name: "Search"});

		expect(input).toHaveProperty("value", "deploy");

		await actAndSettle(() => {
			fireEvent.change(input, {target: {value: "review"}});
		});
		expect(router.state.location.searchStr).toBe("?q=review");

		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("button", {name: "Clear search"}));
		});
		expect({
			search: router.state.location.searchStr,
			collapsed: screen.queryByRole("searchbox") === null,
		}).toStrictEqual({search: "", collapsed: true});
	});

	it("disables Filter and Sort while a search term is set", async () => {
		await renderCustomize("/customize/skills?q=deploy");
		const searching = [
			screen.getByRole("button", {name: "Filter"}).hasAttribute("disabled"),
			screen.getByRole("button", {name: "Sort by Last edited"}).hasAttribute("disabled"),
		];
		cleanup();

		await renderCustomize("/customize/skills");
		const idle = [
			screen.getByRole("button", {name: "Filter"}).hasAttribute("disabled"),
			screen.getByRole("button", {name: "Sort by Last edited"}).hasAttribute("disabled"),
		];

		expect({searching, idle}).toStrictEqual({
			searching: [true, true],
			idle: [false, false],
		});
	});

	it("shows only the unified no-match line when the search finds nothing", async () => {
		await renderCustomize("/customize/skills?q=zzz-nothing");
		const panel = screen.getByRole("tabpanel");

		expect({
			lines: [...panel.querySelectorAll("p")].map((node) => node.textContent),
			fallback: panel.querySelector("h3"),
		}).toStrictEqual({
			lines: ["No results match \u201czzz-nothing\u201d", "No results match \u201czzz-nothing\u201d"],
			fallback: null,
		});
	});

	it("lists skills whose description matches the search term as unified hits", async () => {
		await renderCustomize("/customize/skills?q=release");

		expect(unifiedHitKeys()).toStrictEqual(["Yours", "deploy-checklist"]);
	});

	it("labels each skill row View <name> with a More actions kebab", async () => {
		await renderCustomize("/customize/skills");

		expect({
			view: screen.getAllByRole("button", {name: /^View /}).map((button) => button.getAttribute("aria-label")),
			kebab: screen
				.getAllByRole("button", {name: /^More actions for /})
				.map((button) => button.getAttribute("aria-label")),
		}).toStrictEqual({
			view: ["View deploy-checklist"],
			kebab: ["More actions for deploy-checklist"],
		});
	});

	it("offers Open folder and Copy /name in the row kebab", async () => {
		await renderCustomize("/customize/skills");
		fireEvent.click(screen.getByRole("button", {name: "More actions for deploy-checklist"}));
		await flush();

		expect(
			within(screen.getByRole("menu"))
				.getAllByRole("menuitem")
				.map((item) => item.textContent),
		).toStrictEqual(["Open folder", "Copy /deploy-checklist"]);
	});

	it("groups skills under Personal, Project and From plugins headers with counters", async () => {
		await renderCustomize("/customize/skills", [...SKILLS, ...EXTRA_SKILLS]);

		expect(
			screen.getAllByRole("heading", {level: 3}).map((heading) => heading.parentElement?.textContent),
		).toStrictEqual(["Personal1", "Project · web1", "From plugins1"]);
		expect(screen.getAllByTestId("customize-list-row").map((row) => row.textContent)).toStrictEqual([
			"deploy-checklistfrom Personal·Walk the release checklist before shipping.Sep 15",
			"lintfrom web·Lint the web app.Sep 20",
			"pdffrom document-skills·Read and write PDFs.Sep 10",
		]);
	});

	it("shows the onboarding card when there are no personal skills", async () => {
		await renderCustomize("/customize/skills", EXTRA_SKILLS);
		const card = screen.getByTestId("customize-skills-onboarding");

		expect([...card.querySelectorAll("h3, p")].map((node) => node.textContent)).toStrictEqual([
			"Add your first skills",
			"Personal skills live in ~/.claude/skills.",
		]);
	});

	it("hides the onboarding card while personal skills exist", async () => {
		await renderCustomize("/customize/skills");
		expect(screen.queryByTestId("customize-skills-onboarding")).toBeNull();
	});

	it("restores the persisted sort from localStorage", async () => {
		localStorage.setItem("ccb-customize-skills-sort", "name");
		await renderCustomize("/customize/skills", [...SKILLS, ...EXTRA_SKILLS]);
		await flush();

		expect(screen.getByRole("button", {name: "Sort by Name"})).toBeTruthy();
	});

	it("ignores an unknown persisted sort", async () => {
		localStorage.setItem("ccb-customize-skills-sort", "bogus");
		await renderCustomize("/customize/skills");
		await flush();

		expect(screen.getByRole("button", {name: "Sort by Last edited"})).toBeTruthy();
	});

	it("persists the chosen sort to localStorage", async () => {
		await renderCustomize("/customize/skills");
		fireEvent.click(screen.getByRole("button", {name: "Sort by Last edited"}));
		await flush();
		fireEvent.click(screen.getByRole("menuitemradio", {name: "Name"}));
		await flush();

		expect({
			stored: localStorage.getItem("ccb-customize-skills-sort"),
			label: screen.getByRole("button", {name: "Sort by Name"}).getAttribute("aria-label"),
		}).toStrictEqual({stored: "name", label: "Sort by Name"});
	});
});

describe("customize header sizes", () => {
	it("renders Yours | Discover with the shared 32px segmented control", async () => {
		await renderCustomize("/customize/skills");
		const group = screen.getByRole("radiogroup", {name: "Skills"});

		expect({
			group: group.className.split(" ").includes("h-8"),
			radios: within(group)
				.getAllByRole("radio")
				.map((radio) => [radio.tagName, radio.className.split(" ").includes("rounded-r5")]),
		}).toStrictEqual({
			group: true,
			radios: [
				["SPAN", true],
				["SPAN", true],
			],
		});
	});

	it("sizes the skill detail back link as an xs button", async () => {
		const skill = SKILLS[0];
		if (skill === undefined) throw new Error("Expected a skill fixture");
		const detail: SkillDetail = {skill, userInvocable: true, modelInvocable: true, allowedTools: [], tree: []};
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		const rootRoute = createRootRoute({
			component: () => (
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<SkillDetailHeader detail={detail} />
					</ToastProvider>
				</QueryClientProvider>
			),
		});
		const router = createRouter({routeTree: rootRoute, history: createMemoryHistory({initialEntries: ["/"]})});
		await router.load();
		render(<RouterProvider router={router} />);

		const classes = (await screen.findByRole("link", {name: "Your skills"})).className.split(" ");
		expect(["h-6", "text-[13px]/[19px]", "rounded-r6", "px-2"].filter((c) => !classes.includes(c))).toStrictEqual(
			[],
		);
	});
});

describe("customize discover", () => {
	function cardTexts() {
		return screen.getAllByTestId("customize-discover-card").map((card) => card.textContent);
	}

	it("renders Most installed and Recently updated cards with install state", async () => {
		await renderCustomize("/customize/plugins?view=discover");

		expect({
			headings: screen.getAllByRole("heading", {level: 3}).map((h) => h.textContent),
			cards: cardTexts(),
			stale: screen.getByTestId("customize-discover-stale").textContent.includes("Aug 31, 2026"),
			filter: screen.getByRole("button", {name: "Filter"}).tagName,
			sort: screen.getByRole("button", {name: "Sort"}).tagName,
		}).toStrictEqual({
			headings: ["Most installed", "Recently updated"],
			cards: ["DeployShip safely.by Anthropic·8.3M installs", "DeployShip safely.by Anthropic·8.3M installs"],
			stale: true,
			filter: "BUTTON",
			sort: "BUTTON",
		});
	});

	it("draws each Discover card as upstream does: 11px radius, 14px padding, transparent with a hairline, a 48px tile with a 26px glyph and 17px/16px text", async () => {
		await renderCustomize("/customize/plugins?view=discover");
		const card = screen.getAllByTestId("customize-discover-card")[0];
		const classes = (element: Element | null | undefined) => new Set(element?.getAttribute("class")?.split(" "));
		const missing = (element: Element | null | undefined, expected: string[]) =>
			expected.filter((name) => !classes(element).has(name));
		expect({
			card: missing(card, ["rounded-discover-card", "p-3.5", "border", "border-border"]),
			cardFilled: [...classes(card)].filter((name) => name.startsWith("bg-")),
			tile: missing(card?.querySelector("[data-testid=customize-icon-tile]"), [
				"size-12",
				"rounded-r6",
				"bg-surface-0",
			]),
			glyph: missing(card?.querySelector("[data-testid=customize-icon-tile] svg"), ["size-[26px]"]),
			description: missing(card?.querySelector("p"), ["leading-[17px]"]),
			meta: missing(card?.querySelector("[data-discover-meta]"), ["text-[13px]/[16px]", "text-ink-muted"]),
		}).toStrictEqual({card: [], cardFilled: [], tile: [], glyph: [], description: [], meta: []});
	});

	it("narrows Discover to one category grid through ?category=", async () => {
		await renderCustomize("/customize/plugins?view=discover&category=deployment");

		expect({
			headings: screen.getAllByRole("heading", {level: 3}).map((h) => h.textContent),
			cards: cardTexts(),
		}).toStrictEqual({
			headings: ["Deployment"],
			cards: ["DeployShip safely.by Anthropic·8.3M installs"],
		});
	});

	it("sorts Discover into one grid through ?order=", async () => {
		await renderCustomize("/customize/plugins?view=discover&order=name");

		expect({
			headings: screen.getAllByRole("heading", {level: 3}).map((h) => h.textContent),
			cards: cardTexts(),
		}).toStrictEqual({
			headings: ["All categories"],
			cards: [
				"DeployShip safely.by Anthropic·8.3M installs",
				"tidyTidy up the deploy scripts.by communityInstalled",
			],
		});
	});

	it("copies the install command from the + button", async () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		await renderCustomize("/customize/plugins?view=discover");

		await actAndSettle(() => {
			fireEvent.click(screen.getAllByRole("button", {name: "Copy install command for Deploy"})[0]!);
		});

		expect({
			calls: writeText.mock.calls,
			toast: screen.getByText("Command copied: claude plugin install deploy@claude-plugins-official").textContent,
		}).toStrictEqual({
			calls: [["claude plugin install deploy@claude-plugins-official"]],
			toast: "Command copied: claude plugin install deploy@claude-plugins-official",
		});
	});
});

describe("customize add menu", () => {
	function menuItems() {
		return within(screen.getByRole("menu"))
			.getAllByRole("menuitem")
			.map((item) => item.textContent);
	}

	async function openAddMenu(name: string) {
		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("button", {name}));
		});
		await flush();
	}

	it("starts a session with the skill-creator prompt from the Skills Add menu", async () => {
		const skillCreator: SkillSummary = {
			id: "plugin:skill-creator@anthropic:skill-creator",
			name: "skill-creator",
			description: "Create new skills.",
			source: "plugin",
			sourceLabel: "skill-creator",
			dir: "/Users/test/.claude/plugins/cache/skill-creator/skills/skill-creator",
			mtime: Date.parse("2026-09-12T12:00:00Z"),
			enabled: true,
		};
		await renderCustomize("/customize/skills", [...SKILLS, skillCreator]);
		await openAddMenu("Add skill");
		const items = menuItems();

		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("menuitem", {name: "Create with Claude"}));
		});

		expect({
			items,
			prompts: vi.mocked(startClaudeSession).mock.calls.map(([prompt]) => prompt),
		}).toStrictEqual({items: ["Create with Claude"], prompts: ["/skill-creator"]});
	});

	it("falls back to a plain prompt when the skill-creator skill is absent", async () => {
		await renderCustomize("/customize/skills");
		await openAddMenu("Add skill");

		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("menuitem", {name: "Create with Claude"}));
		});

		expect(vi.mocked(startClaudeSession).mock.calls.map(([prompt]) => prompt)).toStrictEqual([
			"Create a new skill",
		]);
	});

	it("offers Add marketplace and Create with Claude in the Plugins Add menu", async () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		await renderCustomize("/customize/plugins");
		await openAddMenu("Add plugin");
		const items = menuItems();

		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("menuitem", {name: "Add marketplace"}));
		});
		await flush();

		expect({
			items,
			calls: writeText.mock.calls,
			toast: screen.getByText("Command copied: claude plugin marketplace add").textContent,
		}).toStrictEqual({
			items: ["Add marketplace", "Create with Claude"],
			calls: [["claude plugin marketplace add "]],
			toast: "Command copied: claude plugin marketplace add",
		});
	});

	it("copies the claude mcp add command from the Connectors Add menu", async () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		await renderCustomize("/customize/connectors");
		await openAddMenu("Add connector");
		const items = menuItems();

		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("menuitem", {name: "Add custom connector"}));
		});
		await flush();

		expect({
			items,
			calls: writeText.mock.calls,
			toast: screen.getByText("Command copied: claude mcp add").textContent,
		}).toStrictEqual({
			items: ["Add custom connector"],
			calls: [["claude mcp add "]],
			toast: "Command copied: claude mcp add",
		});
	});
});

function hit(key: string, name: string, kind: UnifiedHit["kind"] = "Plugin"): UnifiedHit {
	return {
		key,
		kind,
		name,
		byline: "from Anthropic",
		description: `${name} description`,
		verified: false,
		match: null,
		open: null,
		actions: null,
	};
}

const YOURS_HIT = hit("skill:mcp-builder", "mcp-builder", "Skill");
const MORE_HITS = Array.from({length: 20}, (_, index) => hit(`catalog:mcp-${index}`, `mcp-plugin-${index}`));

function renderResults(props: Partial<Parameters<typeof UnifiedSearchResults>[0]> = {}) {
	const onRetry = vi.fn<() => void>();
	render(
		<UnifiedSearchResults
			q="mcp"
			surface="dialog"
			search={{yours: [YOURS_HIT], more: MORE_HITS}}
			catalogPending={false}
			catalogError={false}
			onRetry={onRetry}
			{...props}
		/>,
	);
	return {onRetry};
}

const REVEAL_CLASSES = ["animate-[reveal-in_120ms_cubic-bezier(.165,.84,.44,1)]", "motion-reduce:animate-none"];

function sectionSummary(testId: string) {
	const section = screen.queryByTestId(testId);
	if (section === null) return null;
	const header = section.firstElementChild as HTMLElement;
	return {
		tag: section.tagName,
		classes: [...section.classList],
		headerClasses: [...header.classList],
		heading: header.querySelector("h3")?.textContent,
		counter: within(header).getByTestId("customize-counter").textContent,
		counterPadding: [...within(header).getByTestId("customize-counter").classList].filter((c) =>
			c.startsWith("px-"),
		),
		rows: section.querySelectorAll(
			"[data-testid=customize-list-row], [data-testid=customize-unified-search-addable-hit-row]",
		).length,
	};
}

describe("UnifiedSearchResults", () => {
	it("renders the sr-only count, the busy-free root and the Yours and More sections", () => {
		renderResults();
		const root = screen.getByTestId("customize-unified-search-results");
		const status = root.previousElementSibling as HTMLElement;

		expect({
			status: {
				tag: status.tagName,
				role: status.getAttribute("role"),
				classes: [...status.classList],
				text: status.textContent,
			},
			root: {busy: root.getAttribute("aria-busy"), classes: [...root.classList]},
			yours: sectionSummary("customize-unified-search-yours"),
			more: sectionSummary("customize-unified-search-more"),
		}).toStrictEqual({
			status: {tag: "P", role: "status", classes: ["sr-only"], text: "21 results matching \u201cmcp\u201d"},
			root: {busy: "false", classes: ["flex", "flex-col", "gap-7"]},
			yours: {
				tag: "SECTION",
				classes: ["flex", "flex-col", "gap-3", ...REVEAL_CLASSES],
				headerClasses: ["flex", "min-h-7", "items-center", "gap-2"],
				heading: "Yours",
				counter: "1",
				counterPadding: ["px-0"],
				rows: 1,
			},
			more: {
				tag: "SECTION",
				classes: ["flex", "flex-col", "gap-3", ...REVEAL_CLASSES],
				headerClasses: ["flex", "min-h-7", "items-center", "gap-2"],
				heading: "More you can add",
				counter: "20",
				counterPadding: ["px-[5.4px]"],
				rows: 12,
			},
		});
	});

	it("spaces each section by surface: 16px on the page, 12px in the dialog, root and header unchanged", () => {
		const layout = () => {
			const root = screen.getByTestId("customize-unified-search-results");
			const sections = [...root.querySelectorAll<HTMLElement>("section[data-testid^=customize-unified-search-]")];
			return {
				root: [...root.classList],
				sections: sections.map((section) => ({
					testId: section.dataset["testid"],
					gap: [...section.classList].filter((c) => c.startsWith("gap-")),
					header: [...(section.firstElementChild as HTMLElement).classList],
				})),
			};
		};
		renderResults({surface: "page"});
		const page = layout();
		cleanup();
		renderResults({surface: "dialog"});
		const dialog = layout();

		const header = ["flex", "min-h-7", "items-center", "gap-2"];
		const root = ["flex", "flex-col", "gap-7"];
		expect({page, dialog}).toStrictEqual({
			page: {
				root,
				sections: [
					{testId: "customize-unified-search-yours", gap: ["gap-4"], header},
					{testId: "customize-unified-search-more", gap: ["gap-4"], header},
				],
			},
			dialog: {
				root,
				sections: [
					{testId: "customize-unified-search-yours", gap: ["gap-3"], header},
					{testId: "customize-unified-search-more", gap: ["gap-3"], header},
				],
			},
		});
	});

	it("reads the singular count and formats thousands", () => {
		renderResults({q: "xy", search: {yours: [YOURS_HIT], more: []}});
		const single = screen.getByTestId("customize-unified-search-results").previousElementSibling?.textContent;
		cleanup();
		const many = Array.from({length: 1243}, (_, index) => hit(`catalog:${index}`, `p${index}`));
		renderResults({search: {yours: [], more: many}});
		const plural = screen.getByTestId("customize-unified-search-results").previousElementSibling?.textContent;

		expect({
			single,
			plural,
			showAll: screen.getByRole("button", {name: "Show all 1,243: More you can add"}).textContent,
		}).toStrictEqual({
			single: "1 result matching \u201cxy\u201d",
			plural: "1,243 results matching \u201cmcp\u201d",
			showAll: "Show all 1,243",
		});
	});

	it("omits a section with no hits", () => {
		renderResults({search: {yours: [], more: MORE_HITS}});

		expect({
			yours: screen.queryByTestId("customize-unified-search-yours"),
			more: screen.getByTestId("customize-unified-search-more").getAttribute("data-testid"),
		}).toStrictEqual({yours: null, more: "customize-unified-search-more"});
	});

	it("collapses Yours to 10 rows and offers Show all only above the limit", () => {
		const yours = Array.from({length: 11}, (_, index) => hit(`skill:${index}`, `mcp-skill-${index}`, "Skill"));
		renderResults({search: {yours, more: MORE_HITS.slice(0, 12)}});

		expect({
			yours: sectionSummary("customize-unified-search-yours")?.rows,
			more: sectionSummary("customize-unified-search-more")?.rows,
			buttons: screen
				.getAllByRole("button", {name: /^Show all/})
				.map((button) => button.getAttribute("aria-label")),
		}).toStrictEqual({yours: 10, more: 12, buttons: ["Show all 11: Yours"]});
	});

	it("expands with Show all and collapses with Show fewer, scrolling the header into view", () => {
		const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
		Element.prototype.scrollIntoView = scrollIntoView;
		renderResults();
		const showAll = screen.getByRole("button", {name: "Show all 20: More you can add"});
		const collapsed = {
			classes: [...showAll.classList],
			expanded: showAll.getAttribute("aria-expanded"),
			text: showAll.textContent,
			icon: [...(showAll.querySelector("svg")?.classList ?? [])],
		};

		act(() => {
			fireEvent.click(showAll);
		});
		const showFewer = screen.getByRole("button", {name: "Show fewer: More you can add"});
		const expanded = {
			expanded: showFewer.getAttribute("aria-expanded"),
			text: showFewer.textContent,
			icon: [...(showFewer.querySelector("svg")?.classList ?? [])],
			rows: sectionSummary("customize-unified-search-more")?.rows,
			scrolled: scrollIntoView.mock.calls.length,
		};

		act(() => {
			fireEvent.click(showFewer);
		});

		expect({
			collapsed,
			expanded,
			after: {
				rows: sectionSummary("customize-unified-search-more")?.rows,
				scrolled: scrollIntoView.mock.calls,
				target:
					scrollIntoView.mock.contexts[0] ===
					screen.getByTestId("customize-unified-search-more").firstElementChild,
			},
		}).toStrictEqual({
			collapsed: {
				classes: expect.arrayContaining(["h-7", "ps-2.5", "pe-1.5", "text-body"]),
				expanded: "false",
				text: "Show all 20",
				icon: expect.arrayContaining(["lucide-chevron-down", "size-5", "-me-1"]),
			},
			expanded: {
				expanded: "true",
				text: "Show fewer",
				icon: expect.arrayContaining(["lucide-chevron-up", "size-5", "-me-1"]),
				rows: 20,
				scrolled: 0,
			},
			after: {rows: 12, scrolled: [[{block: "nearest"}]], target: true},
		});
	});

	it("shows only the keep-typing hint below two letters or digits, with no horizontal padding on either surface", () => {
		const probe = (surface: "page" | "dialog") => {
			renderResults({q: "e", surface});
			const hint = screen.getByRole("status");
			const result = {
				tag: hint.tagName,
				classes: [...hint.classList],
				text: hint.textContent,
				root: screen.queryByTestId("customize-unified-search-results"),
				rows: screen.queryAllByTestId("customize-list-row").length,
			};
			cleanup();
			return result;
		};

		const expected = {
			tag: "P",
			classes: ["py-2", "text-footnote", "text-muted-as-secondary"],
			text: "Keep typing to search everything you can add.",
			root: null,
			rows: 0,
		};
		expect({page: probe("page"), dialog: probe("dialog")}).toStrictEqual({page: expected, dialog: expected});
	});

	it("renders the no-match line with an sr-only status and no horizontal padding on either surface", () => {
		const probe = (surface: "page" | "dialog") => {
			renderResults({q: "zzqxvw", surface, search: {yours: [], more: []}});
			const root = screen.getByTestId("customize-unified-search-results");
			const status = root.previousElementSibling as HTMLElement;
			const line = within(root).getByText("No results match \u201czzqxvw\u201d");
			const result = {
				status: {classes: [...status.classList], text: status.textContent},
				line: {tag: line.tagName, classes: [...line.classList]},
				children: root.children.length,
			};
			cleanup();
			return result;
		};

		const expected = {
			status: {classes: ["sr-only"], text: "No results match \u201czzqxvw\u201d"},
			line: {tag: "P", classes: ["py-2", "text-body", "text-secondary", ...REVEAL_CLASSES]},
			children: 1,
		};
		expect({page: probe("page"), dialog: probe("dialog")}).toStrictEqual({page: expected, dialog: expected});
	});

	it("dims the results and shows six skeleton rows for More while the catalog loads", () => {
		renderResults({search: {yours: [YOURS_HIT], more: []}, catalogPending: true});
		const root = screen.getByTestId("customize-unified-search-results");
		const status = root.previousElementSibling as HTMLElement;
		const skeleton = within(root)
			.getAllByTestId("list-rows-skeleton-row")[0]
			?.closest(".animate-\\[cds-fade-in_150ms_ease-out_500ms_backwards\\]");

		expect({
			busy: root.getAttribute("aria-busy"),
			classes: [...root.classList],
			status: status.textContent,
			yours: sectionSummary("customize-unified-search-yours")?.rows,
			skeletonRows: within(root).getAllByTestId("list-rows-skeleton-row").length,
			wrapped: skeleton?.parentElement === root,
			noMatch: within(root).queryByText(/No results match/),
		}).toStrictEqual({
			busy: "true",
			classes: ["flex", "flex-col", "gap-7", "opacity-70", "pointer-events-none"],
			status: "",
			yours: 1,
			skeletonRows: 6,
			wrapped: true,
			noMatch: null,
		});
	});

	it("shows the Couldn\u2019t finish searching banner with Retry above the Yours section", () => {
		const {onRetry} = renderResults({search: {yours: [YOURS_HIT], more: []}, catalogError: true});
		const root = screen.getByTestId("customize-unified-search-results");
		const alert = within(root).getByRole("alert");
		const wrapper = alert.parentElement;

		act(() => {
			fireEvent.click(within(alert).getByRole("button", {name: "Retry"}));
		});

		expect({
			wrapper: {classes: [...(wrapper?.classList ?? [])], first: root.firstElementChild === wrapper},
			alert: {classes: [...alert.classList], text: alert.textContent},
			yours: sectionSummary("customize-unified-search-yours")?.rows,
			retries: onRetry.mock.calls.length,
		}).toStrictEqual({
			wrapper: {classes: ["pb-2", ...REVEAL_CLASSES], first: true},
			alert: {
				classes: expect.arrayContaining(["flex", "items-start", "gap-2", "rounded-card", "px-3", "py-3"]),
				text: "Couldn\u2019t finish searching.Retry",
			},
			yours: 1,
			retries: 1,
		});
	});
});

const MCP_BUILDER_SKILL: SkillSummary = {
	id: "plugin:mcp-builder@claude-plugins-official:mcp-builder",
	name: "mcp-builder",
	description: "Build MCP servers",
	source: "plugin",
	sourceLabel: "mcp-builder",
	dir: "/Users/test/.claude/plugins/mcp-builder/skills/mcp-builder",
	mtime: Date.parse("2026-09-15T12:00:00Z"),
	enabled: true,
};

function renderHitRows(search: {yours: UnifiedHit[]; more: UnifiedHit[]}) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<UnifiedSearchResults
					q="mcp"
					surface="dialog"
					search={search}
					catalogPending={false}
					catalogError={false}
					onRetry={() => {}}
				/>
			</ToastProvider>
		</QueryClientProvider>,
	);
}

const SKILL_HIT: UnifiedHit = {
	key: `skill:${MCP_BUILDER_SKILL.id}`,
	kind: "Skill",
	name: "mcp-builder",
	byline: "from Anthropic",
	description: "Build MCP servers",
	verified: true,
	match: [0, 3],
	open: {kind: "skill", id: MCP_BUILDER_SKILL.id, tab: "overview"},
	actions: {kind: "skill", skill: MCP_BUILDER_SKILL},
};

const PLUGIN_HIT: UnifiedHit = {
	key: "plugin:mcp-tools@community",
	kind: "Plugin",
	name: "mcp-tools",
	byline: "from Community",
	description: "",
	verified: false,
	match: [0, 3],
	open: {kind: "plugin", id: "mcp-tools@community", tab: "overview"},
	actions: {kind: "plugin", pluginId: "mcp-tools@community", name: "mcp-tools", installPath: "/plugins/mcp-tools"},
};

const ADDABLE_HIT: UnifiedHit = {
	key: "catalog:mcp-server-dev@claude-plugins-official",
	kind: "Plugin",
	name: "mcp-server-dev",
	byline: "anthropics/claude-plugins-official",
	description: "Build MCP servers",
	verified: true,
	match: [0, 3],
	open: null,
	actions: {kind: "add", pluginId: "mcp-server-dev@claude-plugins-official"},
};

function nameLine(row: HTMLElement) {
	const line = within(row).getByTestId("tabbed-list-item-row-name-line");
	const name = line.querySelector(".truncate")!;
	return {
		classes: [...line.classList],
		name: [...name.children].map((part) => ({classes: [...part.classList], text: part.textContent})),
		verified: (() => {
			const badge = line.querySelector("[role=img]");
			return badge === null
				? null
				: {
						label: badge.getAttribute("aria-label"),
						classes: [...badge.classList],
						icon: [...(badge.querySelector("svg")?.classList ?? [])],
					};
		})(),
	};
}

function secondLine(row: HTMLElement) {
	const line = within(row).getByTestId("tabbed-list-item-row-second-line");
	return [...line.querySelectorAll("span")].map((part) => ({
		text: part.textContent,
		hidden: part.getAttribute("aria-hidden"),
		classes: [...part.classList],
	}));
}

const MUTED_FOOTNOTE = ["text-footnote", "leading-4", "text-muted-as-secondary"];

describe("unified search hit rows", () => {
	it("highlights the match, adds Verified and leads the second line with the kind word", () => {
		renderHitRows({yours: [SKILL_HIT], more: []});
		const row = within(screen.getByTestId("customize-unified-search-yours")).getByTestId("customize-list-row");

		expect({name: nameLine(row), second: secondLine(row), time: row.querySelector("time")}).toStrictEqual({
			name: {
				classes: ["flex", "min-w-0", "items-center", "gap-2", "text-body", "font-medium", "text-primary"],
				name: [
					{classes: ["font-[580]", "text-primary"], text: "mcp"},
					{classes: [], text: "-builder"},
				],
				verified: {
					label: "Verified",
					classes: ["relative", "inline-flex", "text-muted-as-secondary"],
					icon: expect.arrayContaining(["lucide-badge-check", "size-4"]),
				},
			},
			second: [
				{text: "Skill", hidden: null, classes: ["shrink-0", ...MUTED_FOOTNOTE]},
				{text: "·", hidden: "true", classes: ["shrink-0", ...MUTED_FOOTNOTE]},
				{text: "from Anthropic", hidden: null, classes: ["shrink-0", ...MUTED_FOOTNOTE]},
				{text: "·", hidden: "true", classes: ["shrink-0", ...MUTED_FOOTNOTE]},
				{text: "Build MCP servers", hidden: null, classes: ["min-w-0", "truncate", ...MUTED_FOOTNOTE]},
			],
			time: null,
		});
	});

	it("leaves the name whole when another field matched and skips an empty description", () => {
		renderHitRows({yours: [{...PLUGIN_HIT, match: null}], more: []});
		const row = screen.getByTestId("customize-list-row");

		expect({
			name: nameLine(row).name,
			verified: nameLine(row).verified,
			second: secondLine(row).map((part) => part.text),
		}).toStrictEqual({
			name: [{classes: [], text: "mcp-tools"}],
			verified: null,
			second: ["Plugin", "·", "from Community"],
		});
	});

	it("keeps the Yours row kebabs", () => {
		renderHitRows({yours: [SKILL_HIT, PLUGIN_HIT], more: []});

		expect(
			within(screen.getByTestId("customize-unified-search-yours"))
				.getAllByRole("button", {name: /^More actions for/})
				.map((button) => button.getAttribute("aria-label")),
		).toStrictEqual(["More actions for mcp-builder", "More actions for mcp-tools"]);
	});

	it("renders addable rows with a secondary Add button that copies the install command, then a menu spacer", async () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		renderHitRows({yours: [], more: [ADDABLE_HIT]});
		const row = within(screen.getByTestId("customize-unified-search-more")).getByTestId(
			"customize-unified-search-addable-hit-row",
		);
		const action = within(row).getByTestId("tabbed-list-item-row-action");
		const add = within(action).getByRole("button", {name: "Add mcp-server-dev"});
		const spacer = action.nextElementSibling as HTMLElement;

		await actAndSettle(() => {
			fireEvent.click(add);
		});
		await flush();

		expect({
			add: {text: add.textContent, classes: add.className.split(" ")},
			actionChildren: action.children.length,
			spacer: {
				testId: spacer.getAttribute("data-testid"),
				hidden: spacer.getAttribute("aria-hidden"),
				classes: [...spacer.classList],
			},
			calls: writeText.mock.calls,
			toast: screen.getByText("Command copied: claude plugin install mcp-server-dev@claude-plugins-official")
				.textContent,
		}).toStrictEqual({
			add: {
				text: "Add",
				classes: expect.arrayContaining([
					"h-8",
					"px-3",
					"rounded-r6",
					"bg-fill-secondary",
					"shadow-field-drop",
				]),
			},
			actionChildren: 1,
			spacer: {
				testId: "tabbed-list-row-menu-spacer",
				hidden: "true",
				classes: ["aspect-square", "h-8", "shrink-0"],
			},
			calls: [["claude plugin install mcp-server-dev@claude-plugins-official"]],
			toast: "Command copied: claude plugin install mcp-server-dev@claude-plugins-official",
		});
	});
});

/** The Customize panel inside the Settings dialog, with its hash held in local state. */
async function renderDialogPanel(
	initialHash: string,
	{
		skills = [...SKILLS, ...EXTRA_SKILLS],
		catalog = DISCOVER,
	}: {skills?: SkillSummary[]; catalog?: DiscoverCatalog} = {},
) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(customizeSkillsQueryOptions.queryKey, skills);
	for (const skill of skills) {
		const detail: SkillDetail = {skill, userInvocable: true, modelInvocable: true, allowedTools: [], tree: []};
		queryClient.setQueryData(customizeSkillDetailQueryOptions(skill.id).queryKey, detail);
	}
	queryClient.setQueryData(userCommandsQueryOptions.queryKey, []);
	queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, MCP_SERVERS);
	queryClient.setQueryData(customizeClaudeAiConnectorsQueryOptions.queryKey, []);
	queryClient.setQueryData(customizeDiscoverQueryOptions.queryKey, catalog);
	queryClient.setQueryData(pluginsQueryOptions.queryKey, []);
	const hashes: string[] = [initialHash];

	function Harness() {
		const [hash, setHash] = useState(initialHash);
		const location = parseCustomizeHash(hash);
		if (location === null) throw new Error(`Not a customize hash: ${hash}`);
		return (
			<CustomizeDialogPanel
				location={location}
				onNavigate={(next) => {
					hashes.push(next);
					setHash(next);
				}}
			/>
		);
	}

	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Harness />
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
	await screen.findByRole("button", {name: "Search"});
	return hashes;
}

function rowName(row: HTMLElement): string {
	return (
		(row.querySelector("[data-testid=tabbed-list-item-row-name-line]") ?? row.querySelector(".font-medium"))
			?.textContent ?? ""
	);
}

function unifiedHitKeys(): string[] {
	const results = screen.getByTestId("customize-unified-search-results");
	return [...results.querySelectorAll<HTMLElement>("section")].flatMap((section) => [
		within(section).getByRole("heading", {level: 3}).textContent,
		...[
			...section.querySelectorAll<HTMLElement>(
				"[data-testid=customize-list-row], [data-testid=customize-unified-search-addable-hit-row]",
			),
		].map((row) => rowName(row)),
	]);
}

describe("unified search in the Settings dialog", () => {
	it("renders the same unified results in every section and both views, replacing the normal list", async () => {
		const results: Record<string, {keys: string[]; normalRows: number; hashes: string[]}> = {};
		for (const hash of [
			"customize/skills/yours",
			"customize/connectors/yours",
			"customize/plugins/yours",
			"customize/skills/discover",
		]) {
			const hashes = await renderDialogPanel(hash);
			fireEvent.change(openSearch(), {target: {value: "deploy"}});
			const normalRows =
				document.querySelectorAll("[data-testid=customize-discover-card], table").length +
				screen.queryAllByTestId("customize-list-row").length -
				within(screen.getByTestId("customize-unified-search-results")).queryAllByTestId("customize-list-row")
					.length;
			results[hash] = {keys: unifiedHitKeys(), normalRows, hashes};
			cleanup();
		}

		const expected = (hash: string) => ({
			keys: ["Yours", "deploy-checklist", "More you can add", "Deploy"],
			normalRows: 0,
			hashes: [hash],
		});
		expect(results).toStrictEqual({
			"customize/skills/yours": expected("customize/skills/yours"),
			"customize/connectors/yours": expected("customize/connectors/yours"),
			"customize/plugins/yours": expected("customize/plugins/yours"),
			"customize/skills/discover": expected("customize/skills/discover"),
		});
	});

	it("keeps Filter and Sort enabled while searching", async () => {
		await renderDialogPanel("customize/skills/yours");
		fireEvent.change(openSearch(), {target: {value: "deploy"}});

		expect([
			screen.getByRole("button", {name: "Filter"}).hasAttribute("disabled"),
			screen.getByRole("button", {name: "Sort by Last edited"}).hasAttribute("disabled"),
		]).toStrictEqual([false, false]);
	});

	it("restores the section's normal list when the query is emptied", async () => {
		await renderDialogPanel("customize/skills/yours");
		const input = openSearch();
		fireEvent.change(input, {target: {value: "deploy"}});
		fireEvent.change(input, {target: {value: ""}});

		expect({
			unified: screen.queryByTestId("customize-unified-search-results"),
			rows: screen.getAllByTestId("customize-list-row").map((row) => rowName(row)),
		}).toStrictEqual({
			unified: null,
			rows: ["deploy-checklist", "lint", "pdf"],
		});
	});
});

const MCP_SKILL: SkillSummary = {
	id: "personal:mcp-builder",
	name: "mcp-builder",
	description: "Build MCP servers.",
	source: "personal",
	sourceLabel: "Personal",
	dir: "/Users/test/.claude/skills/mcp-builder",
	mtime: Date.parse("2026-09-15T12:00:00Z"),
	enabled: true,
};

/** 13 addable catalog plugins matching "mcp", one more than More you can add shows collapsed. */
const MCP_CATALOG: DiscoverCatalog = {
	fetchedAt: "2026-08-31T12:09:45.226Z",
	plugins: Array.from({length: 13}, (_, index) => ({
		id: `mcp-tool-${index}@community`,
		name: `mcp-tool-${index}`,
		title: `mcp-tool-${index}`,
		marketplace: "community",
		description: "An MCP tool.",
		author: null,
		category: null,
		installs: 100 - index,
		lastUpdated: null,
		skills: [],
		installed: false,
	})),
};

const BACK_LINK_CLASS =
	"-ms-2 inline-flex h-6 w-fit items-center gap-1.5 rounded-r6 px-2 text-[13px]/[19px] text-secondary no-underline hover:bg-fill-ghost-hover hover:text-primary";

describe("returning to the unified search from an opened hit", () => {
	it("turns the back link into Search, then restores the query, the expanded section and focus", async () => {
		const hashes = await renderDialogPanel("customize/skills/yours", {skills: [MCP_SKILL], catalog: MCP_CATALOG});
		fireEvent.change(openSearch(), {target: {value: "mcp"}});
		fireEvent.click(screen.getByRole("button", {name: "Show all 13: More you can add"}));
		fireEvent.click(screen.getByRole("button", {name: "View mcp-builder"}));
		await screen.findByRole("heading", {level: 2, name: "mcp-builder"});

		const back = screen.getByRole("link", {name: "Search"});
		expect({
			text: back.textContent,
			href: back.getAttribute("href"),
			className: back.className,
			arrow: back.querySelector("svg")?.getAttribute("class"),
			yourSkills: screen.queryByRole("link", {name: "Your skills"}),
			hashes,
		}).toStrictEqual({
			text: "Search",
			href: "#customize/skills/yours",
			className: BACK_LINK_CLASS,
			arrow: "lucide lucide-arrow-left size-4 rtl:-scale-x-100",
			yourSkills: null,
			hashes: ["customize/skills/yours", "customize/skills/yours/id/personal%3Amcp-builder"],
		});

		fireEvent.click(back);
		const field = await screen.findByTestId("customize-header-search");
		expect({
			hashes: hashes.slice(2),
			value: (field as HTMLInputElement).value,
			toggle: screen.getByRole("button", {name: "Show fewer: More you can add"}).getAttribute("aria-expanded"),
			moreRows: within(screen.getByTestId("customize-unified-search-more")).getAllByTestId(
				"customize-unified-search-addable-hit-row",
			).length,
			focused: document.activeElement === field,
		}).toStrictEqual({
			hashes: ["customize/skills/yours"],
			value: "mcp",
			toggle: "true",
			moreRows: 13,
			focused: true,
		});
	});

	it("keeps the Your skills back link when the detail was not opened from a search", async () => {
		await renderDialogPanel("customize/skills/yours", {skills: [MCP_SKILL]});
		fireEvent.click(screen.getByRole("button", {name: "View mcp-builder"}));
		await screen.findByRole("heading", {level: 2, name: "mcp-builder"});

		expect({
			yourSkills: screen.getByRole("link", {name: "Your skills"}).getAttribute("href"),
			search: screen.queryByRole("link", {name: "Search"}),
		}).toStrictEqual({yourSkills: "#customize/skills/yours", search: null});
	});

	it("forgets the search return once the hit is opened again from the normal list", async () => {
		await renderDialogPanel("customize/skills/yours", {skills: [MCP_SKILL], catalog: MCP_CATALOG});
		fireEvent.change(openSearch(), {target: {value: "mcp"}});
		fireEvent.click(screen.getByRole("button", {name: "View mcp-builder"}));
		fireEvent.click(await screen.findByRole("link", {name: "Search"}));
		fireEvent.click(await screen.findByRole("button", {name: "Clear search"}));
		fireEvent.click(screen.getByRole("button", {name: "View mcp-builder"}));
		await screen.findByRole("heading", {level: 2, name: "mcp-builder"});

		expect({
			yourSkills: screen.getByRole("link", {name: "Your skills"}).getAttribute("href"),
			search: screen.queryByRole("link", {name: "Search"}),
		}).toStrictEqual({yourSkills: "#customize/skills/yours", search: null});
	});
});

describe("unified search on the standalone Customize page", () => {
	const DEPLOY_KEYS = ["Yours", "deploy-checklist", "More you can add", "Deploy"];

	function pageResults() {
		const results = screen.getByTestId("customize-unified-search-results");
		return {
			keys: unifiedHitKeys(),
			sectionGaps: [...results.querySelectorAll("section")].map((section) =>
				["gap-3", "gap-4"].filter((gap) => section.classList.contains(gap)),
			),
			normalRows:
				document.querySelectorAll("[data-testid=customize-discover-card], table").length +
				screen.queryAllByTestId("customize-list-row").length -
				within(results).queryAllByTestId("customize-list-row").length,
			value: screen.getByRole<HTMLInputElement>("searchbox").value,
		};
	}

	it("renders the page's unified results on first render of a deep link, in both views", async () => {
		const results: Record<string, ReturnType<typeof pageResults>> = {};
		for (const entry of ["/customize/skills?q=deploy", "/customize/skills?view=discover&q=deploy"]) {
			await renderCustomize(entry);
			results[entry] = pageResults();
			cleanup();
		}

		const expected = {keys: DEPLOY_KEYS, sectionGaps: [["gap-4"], ["gap-4"]], normalRows: 0, value: "deploy"};
		expect(results).toStrictEqual({
			"/customize/skills?q=deploy": expected,
			"/customize/skills?view=discover&q=deploy": expected,
		});
	});

	it("shows the same hits in the same order in every section", async () => {
		const keys: Record<string, string[]> = {};
		for (const entry of [
			"/customize/skills?q=deploy",
			"/customize/connectors?q=deploy",
			"/customize/plugins?q=deploy",
		]) {
			await renderCustomize(entry);
			keys[entry] = unifiedHitKeys();
			cleanup();
		}

		expect(keys).toStrictEqual({
			"/customize/skills?q=deploy": DEPLOY_KEYS,
			"/customize/connectors?q=deploy": DEPLOY_KEYS,
			"/customize/plugins?q=deploy": DEPLOY_KEYS,
		});
	});

	it("drops q from the URL and restores the section's normal list when the field is cleared", async () => {
		const router = await renderCustomize("/customize/skills?q=deploy");
		await actAndSettle(() => {
			fireEvent.change(screen.getByRole("searchbox"), {target: {value: ""}});
		});

		expect({
			search: router.state.location.searchStr,
			unified: screen.queryByTestId("customize-unified-search-results"),
			rows: screen.getAllByTestId("customize-list-row").map((row) => rowName(row)),
		}).toStrictEqual({search: "", unified: null, rows: ["deploy-checklist"]});
	});

	it("writes each keystroke to ?q= by replacing the history entry", async () => {
		const router = await renderCustomize("/customize/skills");
		const length = router.history.length;
		const input = openSearch();
		for (const value of ["d", "de", "dep"]) {
			await actAndSettle(() => {
				fireEvent.change(input, {target: {value}});
			});
		}

		expect({
			search: router.state.location.searchStr,
			added: router.history.length - length,
			keys: unifiedHitKeys(),
		}).toStrictEqual({search: "?q=dep", added: 0, keys: DEPLOY_KEYS});
	});

	it("opens a Yours hit's detail route", async () => {
		const router = await renderCustomize("/customize/skills?q=deploy");
		await actAndSettle(() => {
			fireEvent.click(screen.getByRole("button", {name: "View deploy-checklist"}));
		});

		expect(router.state.location.pathname).toBe("/customize/skills/id/personal%3Adeploy-checklist");
	});
});

describe("retired NoSearchMatches fallback", () => {
	const FALLBACK = /match your search|Try a different term/;

	function noMatchState() {
		const results = screen.getByTestId("customize-unified-search-results");
		return {
			fallback: FALLBACK.test(document.body.textContent),
			lines: [...results.querySelectorAll("p")].map((node) => node.textContent),
		};
	}

	it("renders only the unified no-match line for a no-hit query on every page section and view", async () => {
		const results: Record<string, ReturnType<typeof noMatchState>> = {};
		for (const entry of [
			"/customize/skills?q=zzqxvw",
			"/customize/skills?view=discover&q=zzqxvw",
			"/customize/connectors?q=zzqxvw",
			"/customize/plugins?q=zzqxvw",
			"/customize/plugins?view=discover&q=zzqxvw",
		]) {
			await renderCustomize(entry);
			results[entry] = noMatchState();
			cleanup();
		}

		const expected = {fallback: false, lines: ["No results match \u201czzqxvw\u201d"]};
		expect(results).toStrictEqual({
			"/customize/skills?q=zzqxvw": expected,
			"/customize/skills?view=discover&q=zzqxvw": expected,
			"/customize/connectors?q=zzqxvw": expected,
			"/customize/plugins?q=zzqxvw": expected,
			"/customize/plugins?view=discover&q=zzqxvw": expected,
		});
	});

	it("renders only the unified no-match line for a no-hit query in every dialog section and view", async () => {
		const results: Record<string, ReturnType<typeof noMatchState>> = {};
		for (const hash of [
			"customize/skills/yours",
			"customize/skills/discover",
			"customize/connectors/yours",
			"customize/plugins/yours",
			"customize/plugins/discover",
		]) {
			await renderDialogPanel(hash);
			fireEvent.change(openSearch(), {target: {value: "zzqxvw"}});
			results[hash] = noMatchState();
			cleanup();
		}

		const expected = {fallback: false, lines: ["No results match \u201czzqxvw\u201d"]};
		expect(results).toStrictEqual({
			"customize/skills/yours": expected,
			"customize/skills/discover": expected,
			"customize/connectors/yours": expected,
			"customize/plugins/yours": expected,
			"customize/plugins/discover": expected,
		});
	});
});
