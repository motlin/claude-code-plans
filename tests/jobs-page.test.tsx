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
import {cleanup, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {jobsQueryOptions} from "../src/lib/api/jobs";
import type {Job} from "../src/lib/jobs";
import {Route as JobsRoute} from "../src/routes/jobs";

const HOUR = 60 * 60 * 1000;
const now = Date.now();

function job(overrides: Partial<Job>): Job {
	return {
		id: "0b3837ca",
		name: "expenses-treemap",
		intent: "Build a treemap of recurring expenses",
		state: "done",
		detail: "Treemap built",
		needs: null,
		result: null,
		cwd: "/Users/alice/projects/app",
		createdAt: now - 3 * HOUR,
		updatedAt: now - HOUR,
		sessionId: "0b3837ca-bfa3-4316",
		projectId: "-Users-alice-projects-app",
		children: [],
		timeline: [],
		...overrides,
	};
}

const JOBS: Job[] = [
	job({
		result: "Treemap of recurring expenses by category",
		children: [{id: "12", href: "https://github.com/alice/app/pull/12", kind: "pr", title: null}],
		timeline: [
			{at: now - 2 * HOUR, state: "working", detail: "Reading statements", text: ""},
			{at: now - HOUR, state: "done", detail: "Treemap built", text: "Treemap built"},
		],
	}),
	job({
		id: "221f2efe",
		name: "photo-rescan",
		state: "blocked",
		detail: "Which walk should this fork take?",
		needs: "answer: Which walk should this fork take?",
		updatedAt: now - 2 * HOUR,
		sessionId: "221f2efe-7e21",
	}),
	job({
		id: "171ac680",
		name: "test-command",
		state: "failed",
		detail: "process gone while supervisor was down",
		updatedAt: now - 5 * HOUR,
		sessionId: null,
		projectId: null,
	}),
];

afterEach(() => {
	cleanup();
});

async function renderJobsPage(jobs: Job[]) {
	const queryClient = new QueryClient({
		defaultOptions: {queries: {retry: false, staleTime: Infinity}},
	});
	queryClient.setQueryData(jobsQueryOptions.queryKey, jobs);

	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const {component} = JobsRoute.options;
	const jobsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/jobs",
		...(component ? {component} : {}),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([jobsRoute]),
		history: createMemoryHistory({initialEntries: ["/jobs"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByRole("heading", {level: 1, name: "Background jobs"});
}

function jobRows(): HTMLElement[] {
	return [...screen.getByRole("list", {name: "Background jobs"}).querySelectorAll<HTMLElement>(":scope > li")];
}

describe("jobs route", () => {
	it("lists each job with its state pill, detail, result, time and session link", async () => {
		await renderJobsPage(JOBS);

		const rows = jobRows().map((row) => ({
			title: row.querySelector("[data-job-title]")?.textContent,
			state: row.querySelector("[data-job-state]")?.textContent,
			detail: row.querySelector("[data-job-detail]")?.textContent,
			result: row.querySelector("[data-job-result]")?.textContent ?? null,
			time: row.querySelector("[data-job-time]")?.textContent,
			href: row.querySelector("a[data-primary]")?.getAttribute("href") ?? null,
		}));

		expect(rows).toStrictEqual([
			{
				title: "expenses-treemap",
				state: "Done",
				detail: "Treemap built",
				result: "Treemap of recurring expenses by category",
				time: "1h ago",
				href: "/session/0b3837ca-bfa3-4316",
			},
			{
				title: "photo-rescan",
				state: "Blocked",
				detail: "answer: Which walk should this fork take?",
				result: null,
				time: "2h ago",
				href: "/session/221f2efe-7e21",
			},
			{
				title: "test-command",
				state: "Failed",
				detail: "process gone while supervisor was down",
				result: null,
				time: "5h ago",
				href: null,
			},
		]);
	});

	it("links a job's pull requests and shows its timeline", async () => {
		await renderJobsPage(JOBS);

		const row = within(jobRows()[0] as HTMLElement);

		expect({
			pr: row.getByRole("link", {name: "Pull request 12"}).getAttribute("href"),
			timeline: row
				.getAllByRole("listitem")
				.map((entry) => entry.querySelector("[data-job-timeline-detail]")?.textContent),
		}).toStrictEqual({
			pr: "https://github.com/alice/app/pull/12",
			timeline: ["Treemap built", "Reading statements"],
		});
	});

	it("explains the page when there are no background jobs", async () => {
		await renderJobsPage([]);

		expect(screen.getByRole("status").textContent).toBe("Background jobs you start from Claude Code appear here.");
	});
});
