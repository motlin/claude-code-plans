// @vitest-environment jsdom

import {act, cleanup, render, waitFor} from "@testing-library/react";
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

import {useHomeNextSteps} from "../src/components/home/use-home-next-steps";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {homeDismissalsQueryOptions} from "../src/lib/api/home-dismissals";
import {homeFolderStatusQueryOptions} from "../src/lib/api/home-folder-status";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../src/lib/api/sessions";

const MINUTE = 60 * 1000;

function listItem(id: string): SessionListItem {
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
	};
}

const APPROVALS = {
	approvals: [
		{
			sessionId: "waiting",
			projectId: "-projects-alpha",
			projectName: "alpha",
			toolName: "ExitPlanMode" as const,
			toolUseId: "toolu_1",
			blockedSince: new Date(Date.now() - 5 * MINUTE).toISOString(),
			planFilename: null,
			questionPreview: null,
			questionOptions: [],
		},
	],
};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Renders the hook and records, per render, undefined or each row's detail. */
async function renderHook(queryClient: QueryClient): Promise<((string | null)[] | undefined)[]> {
	const frames: ((string | null)[] | undefined)[] = [];
	function Probe() {
		const nextSteps = useHomeNextSteps();
		frames.push(nextSteps?.rows.map((row) => (row.type === "row" ? row.candidate.detail : row.type)));
		return null;
	}
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({getParentRoute: () => rootRoute, path: "/", component: Probe});
	const router = createRouter({
		routeTree: rootRoute.addChildren([homeRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return frames;
}

function seededClient(): QueryClient {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
	queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
		pages: [{sessions: [listItem("waiting")], nextCursor: null}],
		pageParams: [null],
	});
	queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, {dismissals: {}});
	return queryClient;
}

describe("useHomeNextSteps", () => {
	it("stays undefined until approvals settle, so the first rendered detail is Needs permission", async () => {
		let resolveApprovals: (response: Response) => void = () => {};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === "/api/approvals"
					? new Promise<Response>((resolve) => {
							resolveApprovals = resolve;
						})
					: new Response("{}", {status: 404}),
			),
		);
		const frames = await renderHook(seededClient());
		await waitFor(() => {
			expect(frames.length).toBeGreaterThan(0);
		});

		expect(frames.every((frame) => frame === undefined)).toBe(true);

		act(() => {
			resolveApprovals(Response.json(APPROVALS));
		});
		await waitFor(() => {
			expect(frames.at(-1)).toStrictEqual(["Needs permission"]);
		});

		expect(frames.filter((frame) => frame !== undefined)).toStrictEqual(
			frames.filter((frame) => frame !== undefined).map(() => ["Needs permission"]),
		);
	});

	it("keeps the list mounted once settled, even when a source resets and refetches", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === "/api/approvals" ? new Promise<Response>(() => {}) : new Response("{}", {status: 404}),
			),
		);
		const queryClient = seededClient();
		queryClient.setQueryData(approvalsQueryOptions().queryKey, APPROVALS);
		const frames = await renderHook(queryClient);
		await waitFor(() => {
			expect(frames.at(-1)).toStrictEqual(["Needs permission"]);
		});
		const settledAt = frames.length;

		act(() => {
			void queryClient.resetQueries({queryKey: approvalsQueryOptions().queryKey});
			void queryClient.resetQueries({queryKey: recentSessionsInfiniteQueryOptions().queryKey});
		});
		await waitFor(() => {
			expect(frames.length).toBeGreaterThan(settledAt);
		});

		expect(frames.slice(settledAt)).toStrictEqual(frames.slice(settledAt).map(() => ["Needs permission"]));
	});

	describe("Session running here", () => {
		function folderClient(state: SessionListItem["state"], project = "-projects-alpha"): QueryClient {
			const queryClient = seededClient();
			queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
				pages: [
					{
						sessions: [{...listItem("live"), project, state, bucket: "done"}],
						nextCursor: null,
					},
				],
				pageParams: [null],
			});
			queryClient.setQueryData(approvalsQueryOptions().queryKey, {
				approvals: [],
			});
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
			queryClient.setQueryData(homeFolderStatusQueryOptions("/projects/alpha").queryKey, {
				isGitRepo: true,
				headBranch: "main",
				defaultBranch: "main",
				uncommittedFiles: 0,
			});
			return queryClient;
		}

		it("suggests Turn on Worktree while a live CLI runs in the launch folder", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
			);
			const frames = await renderHook(folderClient("idle"));
			await waitFor(() => {
				expect(frames.at(-1)).toStrictEqual(["Session running here"]);
			});
		});

		it("doesn't for an ended session or one in another folder", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
			);
			const ended = await renderHook(folderClient("ended"));
			await waitFor(() => {
				expect(ended.at(-1)).toStrictEqual([]);
			});
			cleanup();
			const elsewhere = await renderHook(folderClient("idle", "-projects-alpha-sub"));
			await waitFor(() => {
				expect(elsewhere.at(-1)).toStrictEqual([]);
			});
		});
	});
});
