// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";

import {HomeLanding} from "../src/components/home/home-landing";
import {HOME_RECENT_LIMIT} from "../src/components/home/launch-folder";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {homeDismissalsQueryOptions} from "../src/lib/api/home-dismissals";
import {homeFolderStatusQueryOptions} from "../src/lib/api/home-folder-status";
import {localAccountQueryOptions} from "../src/lib/api/local-account";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {
	recentSessionsInfiniteQueryOptions,
	recentSessionsQueryOptions,
	type SessionListItem,
} from "../src/lib/api/sessions";

const MINUTE = 60 * 1000;

function listItem(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
	return {
		id,
		title: `Title ${id}`,
		mtime: new Date(Date.now() - 5 * MINUTE).toISOString(),
		created: new Date(Date.now() - 60 * MINUTE).toISOString(),
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "waiting",
		bucket: "blocked",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

async function renderLanding(queryClient: QueryClient): Promise<void> {
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <HomeLanding />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
}

describe("HomeLanding", () => {
	it("renders only the start card: no Sessions, Pull requests or usage stats sections", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
		);
		const queryClient = new QueryClient({
			defaultOptions: {queries: {retry: false, staleTime: Infinity}},
		});
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
			pages: [
				{
					sessions: [
						listItem("waiting"),
						listItem("finished", {bucket: "review", state: "ended", unseen: true}),
						listItem("pr", {
							bucket: "working",
							state: "working",
							prStatus: {
								number: 12,
								state: "open",
								url: "https://github.com/alice/widgets/pull/12",
								title: "Add widgets",
								checks: {passed: 0, failed: 2, pending: 0},
								review: null,
							},
						}),
					],
					nextCursor: null,
				},
			],
			pageParams: [null],
		});
		queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
		queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, {dismissals: {}});
		queryClient.setQueryData(projectsQueryOptions().queryKey, []);
		queryClient.setQueryData(recentSessionsQueryOptions(HOME_RECENT_LIMIT).queryKey, {
			sessions: [],
			nextCursor: null,
		});
		queryClient.setQueryData(localAccountQueryOptions.queryKey, {
			name: "Craig Motlin",
			firstName: "Craig",
			initial: "C",
		});
		await renderLanding(queryClient);

		const nextSteps = await screen.findByRole("list", {name: "Next steps"});
		const body = document.querySelector("[data-home-action-center]");
		expect({
			title: screen.getByRole("heading", {level: 1}).textContent,
			nextSteps: within(nextSteps).getAllByRole("listitem").length,
			startCard: document.querySelector("[data-start-card]") !== null,
			scroller: body?.parentElement?.hasAttribute("data-home-body"),
			wrapperClass: body?.className,
			slot: [...(body?.children ?? [])].map((slot) => ({
				className: slot.className,
				children: [...slot.children].map((child) => child.hasAttribute("data-start-card")),
			})),
			nextStepsHides: {
				setup: nextSteps.hasAttribute("data-start-card-setup"),
				hideClass: nextSteps.classList.contains("[[data-start-card-setup-hidden]_&]:hidden"),
			},
			h2s: screen.queryAllByRole("heading", {level: 2}).map((heading) => heading.textContent),
			regions: screen.queryAllByRole("region").map((region) => region.getAttribute("aria-label")),
		}).toStrictEqual({
			title: "New session",
			nextSteps: 2,
			startCard: true,
			scroller: true,
			wrapperClass: "flex min-h-full w-full flex-col pb-6",
			slot: [{className: "flex w-full flex-col", children: [true]}],
			nextStepsHides: {setup: true, hideClass: true},
			h2s: [],
			regions: [],
		});
	});

	it("shares the launch folder's Worktree state with Next steps, so pressing Turn on Worktree reads Worktree is on", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
		);
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
			pages: [{sessions: [listItem("live", {bucket: "done", state: "idle"})], nextCursor: null}],
			pageParams: [null],
		});
		queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
		queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, {dismissals: {}});
		queryClient.setQueryData(projectsQueryOptions().queryKey, [
			{
				id: "-projects-alpha",
				name: "alpha",
				projectPath: "/projects/alpha",
				sessionCount: 1,
				memoryCount: 0,
				planCount: 0,
				taskCount: 0,
				activeCount: 1,
				lastActivity: new Date().toISOString(),
			},
		]);
		queryClient.setQueryData(recentSessionsQueryOptions(HOME_RECENT_LIMIT).queryKey, {
			sessions: [],
			nextCursor: null,
		});
		queryClient.setQueryData(homeFolderStatusQueryOptions("/projects/alpha").queryKey, {
			isGitRepo: true,
			headBranch: "main",
			defaultBranch: "main",
			uncommittedFiles: 0,
		});
		await renderLanding(queryClient);

		fireEvent.click(await screen.findByRole("button", {name: /Turn on Worktree/}));

		const taken = await screen.findByTestId("start-card-worktree-apart");
		expect({tag: taken.tagName, text: taken.textContent}).toStrictEqual({tag: "DIV", text: "Worktree is on"});
	});
});
