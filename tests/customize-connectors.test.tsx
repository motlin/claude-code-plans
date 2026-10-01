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
	customizeClaudeAiConnectorsQueryOptions,
	customizeMcpServerDetailQueryOptions,
	customizeMcpServersQueryOptions,
	type ClaudeAiConnectorSummary,
	type McpServerDetail,
	type McpServerSummary,
} from "../src/lib/api/customize";
import {settingsQueryOptions} from "../src/lib/api/settings";
import {toConnectorSlug} from "../src/lib/customize/mcp-tool-permissions";
import {Route as CustomizeLayoutRoute} from "../src/routes/customize";
import {Route as CustomizeConnectorsRoute} from "../src/routes/customize.connectors";
import {Route as ConnectorDetailRoute} from "../src/routes/customize_.connectors.id.$serverId";
import {installLocalStorage} from "./fake-storage";

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const RENDER: McpServerSummary = {
	id: "local:/Users/test/my.app:render",
	name: "render",
	scope: "local",
	transport: "http",
	urlOrCommand: "https://mcp.render.com/mcp",
	enabled: true,
	projectPath: "/Users/test/my.app",
	envKeys: [],
	headerKeys: ["Authorization"],
	needsAuth: false,
};

const SERVERS: McpServerSummary[] = [
	{
		id: "user:imcp",
		name: "imcp",
		scope: "user",
		transport: "stdio",
		urlOrCommand: "imcp-server --stdio",
		enabled: true,
		envKeys: ["IMCP_TOKEN"],
		headerKeys: [],
		needsAuth: false,
	},
	RENDER,
	{
		id: "project:/Users/test/web:approved",
		name: "approved",
		scope: "project",
		transport: "sse",
		urlOrCommand: "https://example.com/sse",
		enabled: false,
		projectPath: "/Users/test/web",
		envKeys: [],
		headerKeys: [],
		needsAuth: false,
	},
	{
		id: "plugin:playwright@official:playwright",
		name: "playwright",
		scope: "plugin",
		transport: "stdio",
		urlOrCommand: "npx @playwright/mcp",
		enabled: true,
		envKeys: [],
		headerKeys: [],
		needsAuth: false,
	},
];

const CLAUDE_AI: ClaudeAiConnectorSummary[] = [{key: "claude_ai_Gmail", name: "Gmail", tools: ["search_threads"]}];

const RENDER_SLUG = toConnectorSlug(RENDER.id);

const DETAIL: McpServerDetail = {
	server: RENDER,
	serverKey: "render",
	tools: [
		{
			name: "delete_service",
			behavior: "deny",
			rule: "mcp__render__delete_service",
			readOnly: false,
		},
		{name: "list_services", behavior: "allow", rule: "mcp__render__*", readOnly: true},
		{name: "update_service", behavior: "allow", rule: "mcp__render__*", readOnly: false},
	],
};

const SETTINGS_JSON = {
	model: "opus",
	permissions: {
		allow: ["Read", "mcp__render__*"],
		deny: ["mcp__render__delete_service"],
	},
};

const SETTINGS_FILES = [
	{
		filename: "settings.json",
		path: "/Users/test/.claude/settings.json",
		exists: true,
		content: JSON.stringify(SETTINGS_JSON, null, 2),
	},
];

function component<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`Expected the ${name} route component`);
	return value;
}

async function renderAt(initialEntry: string) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, SERVERS);
	queryClient.setQueryData(customizeClaudeAiConnectorsQueryOptions.queryKey, CLAUDE_AI);
	queryClient.setQueryData(customizeMcpServerDetailQueryOptions(RENDER_SLUG).queryKey, DETAIL);
	queryClient.setQueryData(settingsQueryOptions.queryKey, SETTINGS_FILES);

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
	const connectorsRoute = createRoute({
		getParentRoute: () => layoutRoute,
		path: "connectors",
		component: component(CustomizeConnectorsRoute.options.component, "connectors"),
	});
	const detailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "customize/connectors/id/$serverId",
		component: component(ConnectorDetailRoute.options.component, "connector detail"),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([layoutRoute.addChildren([connectorsRoute]), detailRoute]),
		history: createMemoryHistory({initialEntries: [initialEntry]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return {router, queryClient};
}

function tableRows() {
	const table = screen.getByRole("table");
	return within(table)
		.getAllByRole("row")
		.slice(1)
		.map((row) =>
			within(row)
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		);
}

describe("connectors table", () => {
	it("lists every scope with its type, scope badge and status, then claude.ai connectors", async () => {
		await renderAt("/customize/connectors");
		await screen.findByRole("table");

		const table = screen.getByRole("table");
		expect({
			headers: within(table)
				.getAllByRole("columnheader")
				.map((header) => header.textContent),
			rows: tableRows(),
			favicon: within(screen.getByRole("row", {name: "View render"}))
				.getByRole("img", {hidden: true})
				.getAttribute("src"),
			claudeAiLink: within(screen.getByRole("row", {name: "View Gmail on claude.ai"}))
				.getByRole("link")
				.getAttribute("href"),
		}).toStrictEqual({
			headers: ["Connector", "Type", "Status"],
			rows: [
				["imcp", "Local User", "Enabled"],
				["render", "Web Local", "Enabled"],
				["approved", "Web Project", "Disabled"],
				["playwright", "Local Plugin", "Enabled"],
				["Gmail", "Web claude.ai", "Manage on claude.ai"],
			],
			favicon: "https://www.google.com/s2/favicons?domain=mcp.render.com&sz=64",
			claudeAiLink: "https://claude.ai/customize/connectors/yours",
		});
	});

	it("filters to disabled servers and opens a server's detail page", async () => {
		const {router} = await renderAt("/customize/connectors?filter=disabled");
		await screen.findByRole("table");

		expect(tableRows()).toStrictEqual([["approved", "Web Project", "Disabled"]]);

		await act(async () => {
			await router.navigate({to: "/customize/connectors", search: {}});
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("row", {name: "View render"}));
		});

		expect(router.state.location.pathname).toBe(`/customize/connectors/id/${RENDER_SLUG}`);
	});
});

describe("connector detail", () => {
	function toolStates() {
		return screen.getAllByRole("radiogroup").map((group) => ({
			label: group.getAttribute("aria-label"),
			checked: within(group)
				.getAllByRole("radio")
				.filter((radio) => radio.getAttribute("aria-checked") === "true")
				.map((radio) => radio.getAttribute("aria-label")),
			disabled: within(group)
				.getAllByRole("radio")
				.every((radio) => radio.hasAttribute("disabled")),
		}));
	}

	it("shows the server URL and read-only tool permissions grouped by kind", async () => {
		await renderAt(`/customize/connectors/id/${RENDER_SLUG}`);
		await screen.findByRole("heading", {level: 2, name: "render"});

		expect({
			copy: screen.getByRole("button", {name: "Copy server URL"}).textContent,
			groups: screen.getAllByRole("button", {expanded: true}).map((button) => button.textContent),
			tools: toolStates(),
			leaksHeaderValue: document.body.textContent?.includes("Bearer") ?? false,
		}).toStrictEqual({
			copy: "https://mcp.render.com/mcp",
			groups: ["Read-only tools1", "Write/delete tools2"],
			tools: [
				{label: "list_services", checked: ["Always allow"], disabled: true},
				{label: "delete_service", checked: ["Blocked"], disabled: true},
				{label: "update_service", checked: ["Always allow"], disabled: true},
			],
			leaksHeaderValue: false,
		});
	});

	it("writes the chosen rule to settings.json once edits are enabled", async () => {
		const fetcher = vi.fn<typeof fetch>(async (input, init) =>
			init?.method === "PUT"
				? Response.json({path: "/Users/test/.claude/settings.json"})
				: String(input) === "/api/settings"
					? Response.json(SETTINGS_FILES)
					: Response.json({error: "unexpected"}, {status: 500}),
		);
		vi.stubGlobal("fetch", fetcher);
		await renderAt(`/customize/connectors/id/${RENDER_SLUG}`);
		await screen.findByRole("heading", {level: 2, name: "render"});

		await act(async () => {
			fireEvent.click(screen.getByRole("switch", {name: "Edit tool permissions"}));
		});
		await act(async () => {
			fireEvent.click(
				within(screen.getByRole("radiogroup", {name: "list_services"})).getByRole("radio", {
					name: "Needs approval",
				}),
			);
		});

		const put = fetcher.mock.calls.find(([, init]) => init?.method === "PUT");
		expect({
			url: put?.[0],
			body: JSON.parse(String(put?.[1]?.body)),
		}).toStrictEqual({
			url: "/api/settings/settings.json",
			body: {
				model: "opus",
				permissions: {
					allow: ["Read", "mcp__render__*"],
					ask: ["mcp__render__list_services"],
					deny: ["mcp__render__delete_service"],
				},
			},
		});
	});
});
