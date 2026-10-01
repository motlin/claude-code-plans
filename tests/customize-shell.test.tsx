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
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ToastProvider} from "../src/components/toast";
import {
	customizeDiscoverQueryOptions,
	customizeMcpServersQueryOptions,
	customizeSkillsQueryOptions,
	type DiscoverCatalog,
	type McpServerSummary,
	type SkillSummary,
} from "../src/lib/api/customize";
import {pluginsQueryOptions} from "../src/lib/api/plugins";
import {Route as CustomizeLayoutRoute} from "../src/routes/customize";
import {Route as CustomizeConnectorsRoute} from "../src/routes/customize.connectors";
import {Route as CustomizePluginsRoute} from "../src/routes/customize.plugins";
import {Route as CustomizeSkillsRoute} from "../src/routes/customize.skills";
import {installLocalStorage} from "./fake-storage";

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
});

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("customize shell", () => {
	it("marks the active section tab and switches sections through the URL", async () => {
		const router = await renderCustomize("/customize/skills");

		expect(sectionTabs()).toStrictEqual([
			{name: "Skills", selected: "true"},
			{name: "Connectors", selected: "false"},
			{name: "Plugins", selected: "false"},
		]);
		expect(screen.getByRole("radiogroup", {name: "Skills"})).toBeTruthy();

		await act(async () => {
			fireEvent.click(screen.getByRole("tab", {name: "Connectors"}));
		});

		expect({
			pathname: router.state.location.pathname,
			tabs: sectionTabs(),
			segmented: screen.queryByRole("radiogroup", {name: "Connectors"}),
			placeholder: screen.getByRole("searchbox").getAttribute("placeholder"),
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

		await act(async () => {
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

	it("round-trips the search term through ?q=", async () => {
		const router = await renderCustomize("/customize/skills?q=deploy");
		const input = screen.getByRole("searchbox", {name: "Search skills and plugins"});

		expect(input).toHaveProperty("value", "deploy");

		await act(async () => {
			fireEvent.change(input, {target: {value: "review"}});
		});
		expect(router.state.location.searchStr).toBe("?q=review");

		await act(async () => {
			fireEvent.click(screen.getByRole("button", {name: "Clear search"}));
		});
		expect({
			search: router.state.location.searchStr,
			value: screen.getByRole("searchbox").getAttribute("value") ?? "",
		}).toStrictEqual({search: "", value: ""});
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

	it("shows the no-match state when the search finds no skills", async () => {
		await renderCustomize("/customize/skills?q=zzz-nothing");
		const empty = within(screen.getByRole("tabpanel")).getByRole("status");

		expect([...empty.querySelectorAll("h3, p")].map((node) => node.textContent)).toStrictEqual([
			"No skills match your search",
			"Try a different term.",
		]);
	});

	it("lists skills whose description matches the search term", async () => {
		await renderCustomize("/customize/skills?q=release");

		expect(screen.getAllByTestId("customize-list-row").map((row) => row.textContent)).toStrictEqual([
			"deploy-checklistfrom Personal·Walk the release checklist before shipping.Sep 15",
		]);
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

describe("customize discover", () => {
	function cardTexts() {
		return screen.getAllByTestId("customize-discover-card").map((card) => card.textContent);
	}

	it("renders Most installed and Recently updated cards with install state", async () => {
		await renderCustomize("/customize/plugins?view=discover");

		expect({
			headings: screen.getAllByRole("heading", {level: 3}).map((h) => h.textContent),
			cards: cardTexts(),
			stale: screen.getByTestId("customize-discover-stale").textContent?.includes("Aug 31, 2026"),
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
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		await renderCustomize("/customize/plugins?view=discover");

		await act(async () => {
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

	it("groups search results into Yours and More you can add", async () => {
		await renderCustomize("/customize/skills?view=discover&q=deploy");

		const sections = screen.getAllByRole("region").map((region) => ({
			heading: within(region).getByRole("heading", {level: 3}).textContent,
			rows: within(region)
				.getAllByTestId("customize-list-row")
				.map((row) => row.querySelector(".font-medium")?.textContent),
		}));
		expect(sections).toStrictEqual([
			{heading: "Yours", rows: ["deploy-checklist"]},
			{heading: "More you can add", rows: ["Deploy"]},
		]);
	});
});
