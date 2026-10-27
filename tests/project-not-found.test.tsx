// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRouter,
	RouterProvider,
	type AnyRoute,
} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {projectMemoriesQueryOptions} from "../src/lib/api/memories";
import {projectApprovalsQueryOptions} from "../src/lib/api/approvals";
import {
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
