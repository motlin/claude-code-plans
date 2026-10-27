// @vitest-environment jsdom

import {act, cleanup, render, waitFor} from "@testing-library/react";
import type {ReactElement} from "react";
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

import {
	HomeLaunchFolderProvider,
	useHomeLaunchFolder,
	type HomeLaunchFolder,
} from "../src/components/home/launch-folder";
import {useHomeNextSteps} from "../src/components/home/use-home-next-steps";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {homeDismissalsQueryOptions} from "../src/lib/api/home-dismissals";
import {homeFolderStatusQueryOptions} from "../src/lib/api/home-folder-status";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../src/lib/api/sessions";
import type {NextStepCandidate} from "../src/lib/home-next-steps";

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
async function renderHook(
	queryClient: QueryClient,
	describeRow: (candidate: NextStepCandidate) => string | null = (candidate) => candidate.detail,
	wrap: (probe: ReactElement) => ReactElement = (probe) => probe,
): Promise<((string | null)[] | undefined)[]> {
	const frames: ((string | null)[] | undefined)[] = [];
	function Probe() {
		const nextSteps = useHomeNextSteps();
		frames.push(nextSteps?.rows.map((row) => (row.type === "row" ? describeRow(row.candidate) : row.type)));
		return null;
	}
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		),
	});
	const homeRoute = createRoute({getParentRoute: () => rootRoute, path: "/", component: () => wrap(<Probe />)});
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

	describe("Hit an error", () => {
		function erroredClient(sessions: SessionListItem[]): QueryClient {
			const queryClient = seededClient();
			queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
				pages: [{sessions, nextCursor: null}],
				pageParams: [null],
			});
			queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
			queryClient.setQueryData(projectsQueryOptions().queryKey, [
				{
					id: "-projects-alpha",
					name: "alpha",
					projectPath: "/projects/alpha",
					sessionCount: sessions.length,
					memoryCount: 0,
					planCount: 0,
					taskCount: 0,
					activeCount: 0,
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

		function errored(id: string, erroredAt: string, project = "-projects-alpha"): SessionListItem {
			return {...listItem(id), project, state: "ended", bucket: "blocked", unseenError: true, erroredAt};
		}

		const describeRow = (candidate: NextStepCandidate) =>
			`${candidate.id} ${candidate.title} · ${candidate.detail}`;

		it("lists only the launch folder's newest errored session as a resume-session row, never as waiting", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
			);
			const frames = await renderHook(
				erroredClient([
					errored("older", "1999-12-31T00:00:01.000Z"),
					errored("newer", "1999-12-31T00:00:02.000Z"),
					errored("elsewhere", "1999-12-31T00:00:03.000Z", "-projects-beta"),
				]),
				describeRow,
			);
			await waitFor(() => {
				expect(frames.at(-1)).toStrictEqual(["resume-session Title newer · Hit an error"]);
			});
		});

		it("lists nothing once the error is seen", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
			);
			const frames = await renderHook(
				erroredClient([{...listItem("seen"), state: "ended", bucket: "done"}]),
				describeRow,
			);
			await waitFor(() => {
				expect(frames.at(-1)).toStrictEqual([]);
			});
		});
	});

	describe("lifecycle", () => {
		function project(name: string) {
			return {
				id: `-projects-${name}`,
				name,
				projectPath: `/projects/${name}`,
				sessionCount: 1,
				memoryCount: 0,
				planCount: 0,
				taskCount: 0,
				activeCount: 1,
				lastActivity: new Date().toISOString(),
			};
		}

		function lifecycleClient(): QueryClient {
			const queryClient = seededClient();
			queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
				pages: [
					{
						sessions: [
							{...listItem("live"), state: "idle", bucket: "done"},
							{
								...listItem("failed"),
								state: "ended",
								bucket: "blocked",
								unseenError: true,
								erroredAt: "1999-12-31T00:00:01.000Z",
							},
						],
						nextCursor: null,
					},
				],
				pageParams: [null],
			});
			queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: []});
			queryClient.setQueryData(projectsQueryOptions().queryKey, [project("alpha"), project("beta")]);
			queryClient.setQueryData(homeFolderStatusQueryOptions("/projects/alpha").queryKey, {
				isGitRepo: true,
				headBranch: "feature",
				defaultBranch: "main",
				uncommittedFiles: 2,
			});
			queryClient.setQueryData(homeFolderStatusQueryOptions("/projects/beta").queryKey, {
				isGitRepo: true,
				headBranch: "main",
				defaultBranch: "main",
				uncommittedFiles: 0,
			});
			return queryClient;
		}

		it("recomputes the folder rows when the folder changes and drops them all while launching", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => Promise.resolve(new Response("{}", {status: 404}))),
			);
			let launchFolder: HomeLaunchFolder | undefined;
			function Controls() {
				launchFolder = useHomeLaunchFolder();
				return null;
			}
			const frames = await renderHook(
				lifecycleClient(),
				(candidate) => `${candidate.id} ${candidate.title}`,
				(probe) => (
					<HomeLaunchFolderProvider>
						<Controls />
						{probe}
					</HomeLaunchFolderProvider>
				),
			);
			act(() => {
				launchFolder?.select("-projects-alpha");
			});
			await waitFor(() => {
				expect(frames.at(-1)).toStrictEqual([
					"resume-session Title failed",
					"worktree-apart Turn on Worktree",
					"continue-branch Continue uncommitted work",
				]);
			});

			act(() => {
				launchFolder?.select("-projects-beta");
			});
			await waitFor(() => {
				expect(frames.at(-1)).toStrictEqual([]);
			});

			act(() => {
				launchFolder?.select("-projects-alpha");
			});
			await waitFor(() => {
				expect(frames.at(-1)).toHaveLength(3);
			});
			act(() => {
				launchFolder?.setLaunching(true);
			});
			await waitFor(() => {
				expect(frames.at(-1)).toStrictEqual([]);
			});
		});
	});
});
