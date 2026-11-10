// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRouter,
	RouterProvider,
	type AnyRoute,
} from "@tanstack/react-router";
import {cleanup, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {z} from "zod";
import {MemoryListResponse, projectMemoriesQueryOptions} from "../src/lib/api/memories";
import {projectApprovalsQueryOptions} from "../src/lib/api/approvals";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import type {SessionListItem} from "../src/lib/api/sessions";
import {ToastProvider} from "../src/components/toast";
import {
	ProjectDetailResponse,
	projectsQueryOptions,
	projectDetailQueryOptions,
	projectPlansQueryOptions,
	projectSessionsQueryOptions,
	projectSubagentsQueryOptions,
	projectTasksQueryOptions,
} from "../src/lib/api/projects";
import {Route as ProjectRoute} from "../src/routes/project.$id";
import {Route as ProjectMemoriesRoute} from "../src/routes/project.$id_.memories";
import {Route as ProjectPlansRoute} from "../src/routes/project.$id_.plans";
import {Route as ProjectSessionsRoute} from "../src/routes/project.$id_.sessions";
import {Route as ProjectSubagentsRoute} from "../src/routes/project.$id_.subagents";
import {Route as ProjectTasksRoute} from "../src/routes/project.$id_.tasks";

vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({activeSessions: new Map()}),
}));

afterEach(cleanup);

const ID = "does-not-exist";

function seededClient(): QueryClient {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(projectDetailQueryOptions(ID).queryKey, null);
	queryClient.setQueryData(projectSessionsQueryOptions(ID).queryKey, []);
	queryClient.setQueryData(projectPlansQueryOptions(ID).queryKey, []);
	queryClient.setQueryData(projectSubagentsQueryOptions(ID).queryKey, []);
	queryClient.setQueryData(projectTasksQueryOptions(ID).queryKey, {
		todos: [],
		todoCounts: {total: 0, pending: 0, inProgress: 0, completed: 0},
	});
	queryClient.setQueryData(projectMemoriesQueryOptions(ID).queryKey, null);
	queryClient.setQueryData(projectApprovalsQueryOptions(ID).queryKey, {approvals: []});
	queryClient.setQueryData(projectsQueryOptions().queryKey, []);
	return queryClient;
}

const cases: Array<{id: string; path: string; url: string; route: AnyRoute}> = [
	{id: "/project/$id", path: "/project/$id", url: `/project/${ID}`, route: ProjectRoute},
	{
		id: "/project/$id_/sessions",
		path: "/project/$id/sessions",
		url: `/project/${ID}/sessions`,
		route: ProjectSessionsRoute,
	},
	{id: "/project/$id_/plans", path: "/project/$id/plans", url: `/project/${ID}/plans`, route: ProjectPlansRoute},
	{id: "/project/$id_/tasks", path: "/project/$id/tasks", url: `/project/${ID}/tasks`, route: ProjectTasksRoute},
	{
		id: "/project/$id_/memories",
		path: "/project/$id/memories",
		url: `/project/${ID}/memories`,
		route: ProjectMemoriesRoute,
	},
	{
		id: "/project/$id_/subagents",
		path: "/project/$id/subagents",
		url: `/project/${ID}/subagents`,
		route: ProjectSubagentsRoute,
	},
];

describe("missing project", () => {
	it.each(cases)(
		"$url renders the generic 404 instead of a Project Not Found page",
		async ({id, path, url, route}) => {
			const queryClient = seededClient();
			const root = createRootRouteWithContext<{queryClient: QueryClient}>()();
			// The same wiring routeTree.gen.ts applies, so Route.useParams() resolves against the real route id.
			// update() is typed for user options only; the generated tree passes id/path the same way (`as any`).
			route.update({id, path, getParentRoute: () => root} as Parameters<AnyRoute["update"]>[0]);
			const router = createRouter({
				routeTree: root.addChildren([route]),
				context: {queryClient},
				history: createMemoryHistory({initialEntries: [url]}),
			});
			await router.load();
			render(
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>,
			);

			const heading = await screen.findByRole("heading", {level: 2});
			const home = screen.getByRole("link", {name: "Go back home"});
			expect({
				inNotFound: heading.closest("[data-not-found]") !== null,
				heading: heading.textContent,
				homeHref: home.getAttribute("href"),
				projectNotFound: screen.queryByText("Project Not Found"),
				projectLine: screen.queryByText("This project could not be found."),
			}).toStrictEqual({
				inNotFound: true,
				heading: "Page not found",
				homeHref: "/",
				projectNotFound: null,
				projectLine: null,
			});
		},
	);
});

const PROJECT = "-Users-alice-projects-demo";

type ProjectDetail = NonNullable<z.infer<typeof ProjectDetailResponse>>;
type ProjectMemories = NonNullable<z.infer<typeof MemoryListResponse>>;

function session(id: string, title: string, mtime: string): SessionListItem {
	return {
		id,
		title,
		mtime,
		created: mtime,
		project: PROJECT,
		projectName: "demo",
		messageCount: 4,
		gitBranch: "main",
		archived: false,
		state: "ended",
		bucket: "done",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

function projectClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false}},
	});
	const detail: ProjectDetail = {
		id: PROJECT,
		name: "demo",
		projectPath: "/Users/alice/projects/demo",
		subagentCount: 3,
	};
	queryClient.setQueryData(projectDetailQueryOptions(PROJECT).queryKey, detail);
	queryClient.setQueryData(projectsQueryOptions().queryKey, [
		{
			id: PROJECT,
			name: "demo",
			projectPath: "/Users/alice/projects/demo",
			sessionCount: 2,
			memoryCount: 1,
			planCount: 0,
			taskCount: 0,
			activeCount: 0,
			lastActivity: "2026-11-09T10:00:00.000Z",
		},
	]);
	queryClient.setQueryData(projectSessionsQueryOptions(PROJECT).queryKey, [
		session("11111111-1111-4111-8111-111111111111", "Fix the flaky test", "2026-11-09T10:00:00.000Z"),
		session("22222222-2222-4222-8222-222222222222", "Untitled session", "2026-11-08T10:00:00.000Z"),
	]);
	queryClient.setQueryData(projectPlansQueryOptions(PROJECT).queryKey, []);
	queryClient.setQueryData(projectSubagentsQueryOptions(PROJECT).queryKey, []);
	queryClient.setQueryData(projectTasksQueryOptions(PROJECT).queryKey, {
		todos: [],
		todoCounts: {total: 0, pending: 0, inProgress: 0, completed: 0},
	});
	const memories: ProjectMemories = {
		project: {id: PROJECT, name: "demo", projectPath: "/Users/alice/projects/demo"},
		memories: [{filename: "notes.md", title: "Project notes", mtime: "2026-11-07T10:00:00.000Z", project: PROJECT}],
	};
	queryClient.setQueryData(projectMemoriesQueryOptions(PROJECT).queryKey, memories);
	queryClient.setQueryData(projectApprovalsQueryOptions(PROJECT).queryKey, {approvals: []});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	return queryClient;
}

const sectionCases = cases.map((c) => ({...c, url: c.url.replace(ID, PROJECT)}));

describe("existing project", () => {
	it.each(sectionCases)(
		"$url draws the shared page header with linked section counts, hiding empty sections",
		async ({id, path, url, route}) => {
			const queryClient = projectClient();
			const root = createRootRouteWithContext<{queryClient: QueryClient}>()();
			route.update({id, path, getParentRoute: () => root} as Parameters<AnyRoute["update"]>[0]);
			const router = createRouter({
				routeTree: root.addChildren([route]),
				context: {queryClient},
				history: createMemoryHistory({initialEntries: [url]}),
			});
			await router.load();
			render(
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<RouterProvider router={router} />
					</ToastProvider>
				</QueryClientProvider>,
			);

			const heading = await screen.findByRole("heading", {level: 1});
			const tabs = screen.getByRole("navigation", {name: "Project sections"});
			const back = screen.getByRole("link", {name: "Projects"});
			expect({
				inPageHeader: heading.closest('[data-cds="PageHeader"]') !== null,
				heading: heading.textContent,
				path: screen.getByText("/Users/alice/projects/demo").tagName,
				backHref: back.getAttribute("href"),
				tabs: within(tabs)
					.getAllByRole("link")
					.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")]),
				topBar: document.querySelector(".-mt-9"),
			}).toStrictEqual({
				inPageHeader: true,
				heading: "demo",
				path: "P",
				backHref: "/projects",
				tabs: [
					["Overview", `/project/${PROJECT}`, url === `/project/${PROJECT}` ? "page" : null],
					["Sessions · 2", `/project/${PROJECT}/sessions`, url.endsWith("/sessions") ? "page" : null],
					...(url.endsWith("/tasks") ? [["Tasks · 0", `/project/${PROJECT}/tasks`, "page"]] : []),
					["Memories · 1", `/project/${PROJECT}/memories`, url.endsWith("/memories") ? "page" : null],
					...(url.endsWith("/plans") ? [["Plans · 0", `/project/${PROJECT}/plans`, "page"]] : []),
					["Subagents · 3", `/project/${PROJECT}/subagents`, url.endsWith("/subagents") ? "page" : null],
				],
				topBar: null,
			});
		},
	);

	it.each(sectionCases.filter((c) => c.url.endsWith(PROJECT) || c.url.endsWith("/sessions")))(
		"$url lists sessions with the shared session row",
		async ({id, path, url, route}) => {
			const queryClient = projectClient();
			const root = createRootRouteWithContext<{queryClient: QueryClient}>()();
			route.update({id, path, getParentRoute: () => root} as Parameters<AnyRoute["update"]>[0]);
			const router = createRouter({
				routeTree: root.addChildren([route]),
				context: {queryClient},
				history: createMemoryHistory({initialEntries: [url]}),
			});
			await router.load();
			render(
				<QueryClientProvider client={queryClient}>
					<ToastProvider>
						<RouterProvider router={router} />
					</ToastProvider>
				</QueryClientProvider>,
			);

			await screen.findByRole("heading", {level: 1});
			const rows = screen
				.getAllByRole("link")
				.filter((link) => link.getAttribute("href")?.startsWith("/session/"));
			expect(
				rows.map((row) => ({
					href: row.getAttribute("href"),
					title: row.firstElementChild?.textContent,
					time: row.querySelector("time")?.getAttribute("dateTime"),
					branch: within(row).getByText("main").className.includes("font-mono"),
				})),
			).toStrictEqual([
				{
					href: "/session/11111111-1111-4111-8111-111111111111",
					title: "Fix the flaky test",
					time: "2026-11-09T10:00:00.000Z",
					branch: true,
				},
				{
					href: "/session/22222222-2222-4222-8222-222222222222",
					title: "Untitled session",
					time: "2026-11-08T10:00:00.000Z",
					branch: true,
				},
			]);
		},
	);
});
