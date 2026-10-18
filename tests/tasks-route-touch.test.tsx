// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {createElement} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {tasksQueryOptions} from "../src/lib/api/tasks";
import {TOUCH_HIT} from "../src/lib/touch-reveal";
import {Route as TasksRoute} from "../src/routes/tasks";

afterEach(() => {
	cleanup();
});

describe("/tasks touch targets", () => {
	it("gives the 12px collapse chevron button a 44px touch hit area", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(tasksQueryOptions.queryKey, [
			{
				projectDir: "project-test-100",
				projectId: "project-test-100",
				projectName: "project-test-100",
				sessionId: null,
				sessionTitle: "Session test 100",
				tasks: [
					{
						taskId: "1",
						projectDir: "project-test-100",
						subject: "Task subject 100",
						description: "",
						status: "pending",
						activeForm: null,
						owner: null,
						blocks: [],
						blockedBy: [],
						metadata: {},
					},
				],
				totalPending: 1,
				totalInProgress: 0,
			},
		]);
		const TasksPage = TasksRoute.options.component as () => React.JSX.Element;
		const rootRoute = createRootRoute({
			component: () => <QueryClientProvider client={queryClient}>{createElement(TasksPage)}</QueryClientProvider>,
		});
		const router = createRouter({routeTree: rootRoute, history: createMemoryHistory({initialEntries: ["/tasks"]})});
		await router.load();
		render(<RouterProvider router={router} />);

		const collapse = await screen.findByRole("button", {name: "Collapse Session test 100"});
		expect(collapse.className).toBe(`cursor-pointer ${TOUCH_HIT}`);
	});
});
