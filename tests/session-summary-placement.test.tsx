// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {pendingQuestionQueryOptions} from "../src/lib/api/pending-question";
import {SessionPage} from "../src/components/session-page";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import {ClaudeEventsProvider} from "../src/components/claude-events-provider";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {type PlanDetail, planQueryOptions} from "../src/lib/api/plans";
import {
	recentSessionsInfiniteQueryOptions,
	sessionDetailQueryOptions,
	sessionOpenInQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptQueryOptions,
	type SessionDetailData,
} from "../src/lib/api/sessions";
import {usageQueryOptions} from "../src/lib/api/usage";
import type {Subagent} from "../src/lib/subagents";
import {__unreadStoreTesting} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";

vi.mock(import("../src/lib/hmr-persist"), async (importOriginal) => ({
	...(await importOriginal()),
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const TITLE = "Sync fork with upstream";
const SUMMARY = "Rebased the fork onto upstream and resolved three conflicts.";
const PROJECT_PATH = "/Users/alice/projects/avalonlogs";

const detail: SessionDetailData = {
	title: TITLE,
	projectName: "avalonlogs",
	projectId: "-Users-alice-projects-avalonlogs",
	homeRoot: "/Users/alice",
	imageRoots: [],
	archived: false,
	summary: SUMMARY,
	projectPath: PROJECT_PATH,
	gitBranch: "alice/sync-upstream",
	cwd: PROJECT_PATH,
	gitSha: null,
	gitClean: null,
	messageCount: 1,
	pendingTaskCount: 0,
	viewedState: {
		currentMessageIndex: 0,
		lastViewedMessageIndex: 0,
		reviewTargetMessageIndex: 0,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

function subagent(id: string): Subagent {
	return {
		id,
		sessionId: SESSION_ID,
		projectId: detail.projectId,
		parentAgentId: null,
		agentType: "Explore",
		attributionAgent: null,
		slug: null,
		description: `Fabricated subagent ${id}`,
		model: null,
		startedAt: null,
		finishedAt: null,
	};
}

class TestResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

class TestEventSource extends EventTarget {
	readonly close = vi.fn<() => void>();
	onerror: ((event: Event) => void) | null = null;
}

class TestIntersectionObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function newQueryClient(): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnMount: false},
		},
	});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: [], writesEnabled: false});
	queryClient.setQueryData(sessionOpenInQueryOptions(SESSION_ID).queryKey, {
		cwd: PROJECT_PATH,
		bridgeSessionId: null,
	});
	return queryClient;
}

async function renderInRouter(queryClient: QueryClient, content: ReactNode) {
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<SettingsProvider>
					<ClaudeEventsProvider>
						<ToastProvider>{content}</ToastProvider>
					</ClaudeEventsProvider>
				</SettingsProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: [`/session/${SESSION_ID}`]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByTestId("session-titlebar");
	await flush();
}

async function renderSessionPage(
	data: SessionDetailData,
	subagents: Subagent[],
	seed: (queryClient: QueryClient) => void = () => {},
	extraRecords: Record<string, unknown>[] = [],
) {
	const queryClient = newQueryClient();
	seed(queryClient);
	queryClient.setQueryData(sessionDetailQueryOptions(SESSION_ID).queryKey, data);
	queryClient.setQueryData(transcriptQueryOptions(SESSION_ID).queryKey, {
		records: [
			{
				type: "user",
				uuid: "u1",
				sessionId: SESSION_ID,
				timestamp: "2026-09-28T10:00:00.000Z",
				message: {role: "user", content: "Fabricated prompt: sync the fork"},
			},
			...extraRecords,
		],
		byteOffset: 0,
		startIndex: 0,
		precedingMessageCount: 0,
	});
	queryClient.setQueryData(sessionSubagentsQueryOptions(SESSION_ID).queryKey, subagents);
	await renderInRouter(queryClient, <SessionPage sessionId={SESSION_ID} />);
}

beforeEach(() => {
	installLocalStorage();
	sessionStorage.clear();
	Element.prototype.scrollIntoView = vi.fn<Element["scrollIntoView"]>();
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal("EventSource", TestEventSource);
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Promise<Response>(() => {})),
	);
	__unreadStoreTesting.reset();
	__unreadStoreTesting.setPersist(async () => Promise.resolve());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	__unreadStoreTesting.reset();
});

describe("AI summary placement", () => {
	it("renders the summary once, as the first transcript row and the title's description", async () => {
		await renderSessionPage(detail, []);

		const rows = screen.getAllByText(SUMMARY);
		const row = rows[0];
		const transcript = row?.parentElement;
		const titleButton = screen.getByRole("button", {name: `${TITLE}, rename session`});
		const header = screen.getByTestId("session-titlebar").parentElement;

		expect({
			count: rows.length,
			rowIsFirstInTranscript: transcript?.firstElementChild === row,
			rowFollowedByMessages: row?.nextElementSibling?.textContent.includes("sync the fork"),
			inHeader: header?.contains(row ?? null),
			tooltip: titleButton.getAttribute("title"),
			description: titleButton.getAttribute("aria-description"),
		}).toStrictEqual({
			count: 1,
			rowIsFirstInTranscript: true,
			rowFollowedByMessages: true,
			inHeader: false,
			tooltip: null,
			description: SUMMARY,
		});
	});

	it("offers Generate AI summary only in the chevron menu", async () => {
		await renderSessionPage({...detail, summary: null}, []);

		const headerButton = screen.queryByRole("button", {name: "Generate AI summary"});
		fireEvent.click(screen.getByRole("button", {name: `More options for ${TITLE}`}));
		await flush();

		expect({
			headerButton,
			menuItem: screen.getByRole("menuitem", {name: "Generate AI summary"}).textContent,
			summaryRow: screen.queryByTestId("session-summary-row"),
			tooltip: screen.getByRole("button", {name: `${TITLE}, rename session`}).getAttribute("title"),
		}).toStrictEqual({
			headerButton: null,
			menuItem: "Generate AI summary",
			summaryRow: null,
			tooltip: null,
		});
	});
});

describe("subagents placement", () => {
	it("moves the subagent count out of the titlebar into the Background tasks pane", async () => {
		await renderSessionPage(detail, [subagent("a1"), subagent("a2")]);

		const pill = screen.getByTestId("session-titlebar").querySelector('[data-origin-pill="subagents"]');
		fireEvent.click(screen.getByRole("button", {name: "View options"}));
		await flush();
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Background tasks"}));
		await flush();
		const link = screen.getByRole("link", {name: "2 subagents"});

		expect({
			pill,
			href: link.getAttribute("href"),
			activeBox: screen.queryByRole("region", {name: "Active subagents"}),
			links: screen.getAllByText(/subagents?$/).length,
		}).toStrictEqual({
			pill: null,
			href: `/session/${SESSION_ID}/subagents`,
			activeBox: null,
			links: 1,
		});
	});
});

describe("plan pane", () => {
	async function openViewOptions() {
		fireEvent.click(screen.getByRole("button", {name: "View options"}));
		await flush();
	}

	it("offers no Plan item when the session has no plan", async () => {
		await renderSessionPage(detail, []);
		await openViewOptions();

		expect(screen.queryByRole("menuitemcheckbox", {name: "Plan"})).toBeNull();
	});

	it("renders the linked plan beside the transcript with a link to the plan page", async () => {
		const plan: PlanDetail = {
			markdown: "# Fabricated sync plan\n\nRebase the fabricated fork onto upstream.",
			mtime: "2026-09-28T10:00:00.000Z",
			title: "Fabricated sync plan",
		};
		await renderSessionPage({...detail, planFilename: "fabricated-sync-plan.md"}, [], (qc) => {
			qc.setQueryData(planQueryOptions("fabricated-sync-plan").queryKey, plan);
		});
		await openViewOptions();
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Plan"}));
		await flush();
		const pane = screen.getByTestId("session-plan-pane");

		expect({
			heading: within(pane).getByRole("heading").textContent,
			body: within(pane).getByText("Rebase the fabricated fork onto upstream.").tagName,
			link: within(pane).getByRole("link", {name: "Open plan"}).getAttribute("href"),
		}).toStrictEqual({
			heading: "Fabricated sync plan",
			body: "P",
			link: "/plan/fabricated-sync-plan",
		});
	});
});

describe("SessionPage dock composition", () => {
	const pr = {number: 100, url: "https://github.com/alice/example-repo/pull/100", repository: "alice/example-repo"};
	function seedUsage(queryClient: QueryClient) {
		const now = Date.UTC(2000, 0, 1);
		queryClient.setQueryData(
			usageQueryOptions.queryKey,
			{
				fiveHour: null,
				sevenDay: {usedPct: 50, resetsAt: now / 1000 + 6 * 24 * 3600},
				updatedAt: new Date(now).toISOString(),
			},
			{updatedAt: now},
		);
	}
	function dockContents() {
		return [
			...document.querySelectorAll(
				"[data-session-footer] [data-branch-strip], [data-session-footer] [role=status], [data-session-footer] [data-composer-card], [data-session-footer] [data-approval-card-root]",
			),
		].map((element) =>
			element.hasAttribute("data-approval-card-root")
				? "permission"
				: element.hasAttribute("data-waiting-input-notice")
					? "waiting"
					: element.hasAttribute("data-pull-request-strip")
						? "pr"
						: element.hasAttribute("data-branch-strip")
							? "branch"
							: element.hasAttribute("data-composer-card")
								? "composer"
								: "usage",
		);
	}
	it.each([
		{name: "linked PR", fields: {pr}, order: ["pr", "usage", "composer"]},
		{
			name: "status-only PR",
			fields: {prStatus: {number: 100, state: "open" as const}},
			order: ["pr", "usage", "composer"],
		},
		{name: "no PR", fields: {}, order: ["usage", "branch", "composer"]},
	])("renders $name dock parts exactly once in their actual production order", async ({fields, order}) => {
		await renderSessionPage({...detail, ...fields}, [], seedUsage);
		expect(dockContents()).toStrictEqual(order);
	});
	it.each([
		{name: "linked PR", fields: {pr}, order: ["pr", "usage", "waiting", "composer"]},
		{name: "no PR", fields: {}, order: ["usage", "branch", "waiting", "composer"]},
	])("docks the waiting notice directly above the composer, below the $name chips", async ({fields, order}) => {
		await renderSessionPage({...detail, ...fields}, [], (queryClient) => {
			seedUsage(queryClient);
			queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
				pages: [{sessions: [{id: SESSION_ID, state: "waiting"}], nextCursor: null}],
				pageParams: [null],
			} as never);
		});
		expect(dockContents()).toStrictEqual(order);
	});
	it("docks the permission card directly above the composer, below the PR and usage chips", async () => {
		await renderSessionPage(
			{...detail, pr},
			[],
			(queryClient) => {
				seedUsage(queryClient);
				queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
					pages: [
						{sessions: [{id: SESSION_ID, state: "waiting", awaitingPermission: true}], nextCursor: null},
					],
					pageParams: [null],
				} as never);
			},
			[
				{
					type: "assistant",
					uuid: "a1",
					sessionId: SESSION_ID,
					timestamp: "2026-09-28T10:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_waiting",
								name: "Bash",
								input: {command: "gh pr create --draft", description: "Open the draft PR"},
							},
						],
					},
				},
			],
		);
		expect(dockContents()).toStrictEqual(["pr", "usage", "permission", "composer"]);
	});
	it("docks the stored question, not a permission card, when the registry's permission wait is really a question", async () => {
		await renderSessionPage(
			{...detail, pr},
			[],
			(queryClient) => {
				seedUsage(queryClient);
				queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
					pages: [
						{sessions: [{id: SESSION_ID, state: "waiting", awaitingPermission: true}], nextCursor: null},
					],
					pageParams: [null],
				} as never);
				queryClient.setQueryData(pendingQuestionQueryOptions(SESSION_ID).queryKey, {
					pendingQuestion: {
						toolUseId: "toolu_question",
						questions: [{question: "Ship it?", options: [{label: "Yes"}, {label: "No"}]}],
					},
				});
			},
			[
				{
					type: "assistant",
					uuid: "a1",
					sessionId: SESSION_ID,
					timestamp: "2026-09-28T10:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_question",
								name: "AskUserQuestion",
								input: {questions: [{question: "Ship it?", options: [{label: "Yes"}, {label: "No"}]}]},
							},
						],
					},
				},
			],
		);
		const card = document.querySelector("[data-session-footer] [data-approval-card-root]");
		expect(card?.getAttribute("aria-label")).toBe("Waiting for your input");
	});
	it("suppresses PR, usage, and composer when the session has neither a project path nor a cwd", async () => {
		await renderSessionPage({...detail, pr, projectPath: null, cwd: null}, [], seedUsage);
		expect(dockContents()).toStrictEqual([]);
	});
	it("hides and restores the PR dock with session chrome", async () => {
		await renderSessionPage({...detail, pr}, [], seedUsage);
		fireEvent.click(screen.getByRole("button", {name: "View options"}));
		await flush();
		fireEvent.click(screen.getByRole("menuitem", {name: "Expand chat"}));
		await flush();
		expect(dockContents()).toStrictEqual([]);
		fireEvent.click(screen.getByRole("button", {name: "Show chrome"}));
		await flush();
		expect(dockContents()).toStrictEqual(["pr", "usage", "composer"]);
	});
});
