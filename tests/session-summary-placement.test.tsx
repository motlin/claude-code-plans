// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {pendingQuestionQueryOptions} from "../src/lib/api/pending-question";
import {SessionPage} from "../src/components/session-page";
import {SettingsProvider} from "../src/components/settings-provider";
import {STORAGE_KEYS} from "../src/components/settings-context";
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
import type {PaneKind} from "../src/lib/pane-layout";
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
	requestedPane?: PaneKind,
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
	await renderInRouter(queryClient, <SessionPage sessionId={SESSION_ID} requestedPane={requestedPane} />);
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
		const link = await screen.findByRole("link", {name: "2 subagents"});

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

	it("offers Plan without a plan file when the transcript has ExitPlanMode plan text or todos, as upstream", async () => {
		await renderSessionPage(detail, [], () => {}, [
			{
				type: "assistant",
				uuid: "a-plan",
				sessionId: SESSION_ID,
				timestamp: "2026-09-28T10:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_plan",
							name: "ExitPlanMode",
							input: {plan: "Rebase onto upstream first."},
						},
						{
							type: "tool_use",
							id: "toolu_todos",
							name: "TodoWrite",
							input: {todos: [{content: "Rebase", status: "in_progress", activeForm: "Rebasing"}]},
						},
					],
				},
			},
		]);
		await openViewOptions();
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Plan"}));
		await flush();
		const pane = screen.getByTestId("session-plan-pane");

		expect({
			plan: within(pane).getByText("Rebase onto upstream first.").tagName,
			todos: within(pane)
				.getAllByRole("listitem")
				.map((item) => [item.textContent, item.getAttribute("data-todo-status")]),
		}).toStrictEqual({plan: "P", todos: [["in progressRebase", "in_progress"]]});
	});

	it("renders the linked plan's markdown verbatim beside the transcript, as upstream renders plan content", async () => {
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
			headings: within(pane)
				.getAllByRole("heading")
				.map((heading) => [heading.tagName, heading.textContent]),
			body: within(pane).getByText("Rebase the fabricated fork onto upstream.").tagName,
			links: within(pane).queryAllByRole("link"),
		}).toStrictEqual({
			headings: [["H1", "Fabricated sync plan"]],
			body: "P",
			links: [],
		});
	});

	it("opens the requested Plan pane on a planless session with upstream's header and empty state", async () => {
		await renderSessionPage(detail, [], () => {}, [], "plan");
		const pane = screen.getByRole("region", {name: "Plan"});
		const before = {
			title: pane.querySelector("[data-pane-title]")?.textContent,
			buttons: within(pane)
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label")),
			empty: within(pane)
				.getAllByRole("paragraph")
				.map((p) => p.textContent),
		};
		fireEvent.click(within(pane).getByRole("button", {name: "Expand"}));
		await flush();
		const expanded = within(screen.getByRole("region", {name: "Plan"}))
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label"));

		expect({before, expanded}).toStrictEqual({
			before: {
				title: "Plan",
				buttons: ["Move", "Expand", "Close"],
				empty: ["No plan yet", "Claude writes the plan here as it explores. Keep chatting."],
			},
			expanded: ["Collapse", "Close"],
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
		{name: "no PR", fields: {}, order: ["usage", "composer"]},
	])("renders $name dock parts exactly once in their actual production order", async ({fields, order}) => {
		await renderSessionPage({...detail, ...fields}, [], seedUsage);
		expect(dockContents()).toStrictEqual(order);
	});
	it("renders the working-copy changes strip above the usage chip when the setting is on", async () => {
		localStorage.setItem(STORAGE_KEYS.showChangesStrip, "true");
		await renderSessionPage(detail, [], seedUsage);
		expect(dockContents()).toStrictEqual(["branch", "usage", "composer"]);
	});
	it.each([
		{name: "linked PR", fields: {pr}, order: ["pr", "usage", "composer"]},
		{name: "no PR", fields: {}, order: ["usage", "composer"]},
	])(
		"says a $name session needs input only on the working line, docking no waiting notice, as upstream does",
		async ({fields, order}) => {
			await renderSessionPage({...detail, ...fields}, [], (queryClient) => {
				seedUsage(queryClient);
				queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
					pages: [{sessions: [{id: SESSION_ID, state: "waiting"}], nextCursor: null}],
					pageParams: [null],
				} as never);
			});
			expect({
				dock: dockContents(),
				turnStatus: document
					.querySelector('[data-testid="code-working-line"] [data-cds="TurnStatus"]')
					?.getAttribute("title"),
			}).toStrictEqual({dock: order, turnStatus: "Needs your input"});
		},
	);
	it("draws the permission card inline after the transcript, as upstream's inline approvals, leaving the dock to the PR chip, usage chip and composer", async () => {
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
		const card = screen.getByRole("group", {name: "Permission request: run"});
		expect({
			dock: dockContents(),
			inline: card.closest("[data-inline-permission]") !== null,
			presentation: card.getAttribute("data-approval-presentation"),
		}).toStrictEqual({dock: ["pr", "usage", "composer"], inline: true, presentation: "card"});
	});
	it("draws the stored question once, inline in the transcript, not a permission card, when the registry's permission wait is really a question", async () => {
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
		expect({
			footer: document.querySelectorAll("[data-session-footer] [data-approval-card-root]").length,
			cards: screen.getAllByRole("group", {name: "Ship it?"}).length,
			tail: document.querySelector("[data-hook-question]"),
		}).toStrictEqual({footer: 0, cards: 1, tail: null});
	});
	describe("answering the stored question", () => {
		const herdrPane = {
			host: "herdr" as const,
			paneId: "w100:p100",
			terminalId: "terminal-test-100",
			workspaceId: "w100",
			tabId: "w100:t100",
			focused: false,
			cwd: PROJECT_PATH,
			foregroundCwd: PROJECT_PATH,
			agentStatus: "blocked",
			agent: "claude",
			terminalTitle: null,
			agentSessionId: SESSION_ID,
			revision: 100,
			sessionId: SESSION_ID,
			via: "agent-session" as const,
			viewedState: detail.viewedState,
		};

		async function renderWaitingQuestion(herdr: {panes: (typeof herdrPane)[]; writesEnabled: boolean}) {
			await renderSessionPage({...detail, pr}, [], (queryClient) => {
				seedUsage(queryClient);
				queryClient.setQueryData(herdrPanesQueryOptions.queryKey, herdr);
				queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
					pages: [{sessions: [{id: SESSION_ID, state: "waiting"}], nextCursor: null}],
					pageParams: [null],
				} as never);
				queryClient.setQueryData(pendingQuestionQueryOptions(SESSION_ID).queryKey, {
					pendingQuestion: {
						toolUseId: "toolu_question",
						questions: [{question: "Ship it?", options: [{label: "Yes"}, {label: "No"}]}],
					},
				});
			});
			const card = screen.getByRole("group", {name: "Ship it?"});
			expect(card.closest("[data-hook-question]")).not.toBeNull();
			return within(card);
		}

		it("lets a session in a writable live herdr pane answer, posting the choice to the pane's question endpoint", async () => {
			const fetchMock = vi.fn<typeof fetch>(async (input) =>
				String(input) === "/api/herdr/question" ? Response.json({ok: true}) : new Promise<Response>(() => {}),
			);
			vi.stubGlobal("fetch", fetchMock);
			const card = await renderWaitingQuestion({panes: [herdrPane], writesEnabled: true});

			fireEvent.click(card.getByRole("button", {name: /^No/}));
			fireEvent.click(card.getByRole("button", {name: /^Submit/}));
			await flush();

			expect({
				footnote: card.queryByText("Answer in the terminal"),
				posts: fetchMock.mock.calls
					.filter(([input]) => String(input) === "/api/herdr/question")
					.map(([, init]) => JSON.parse(String(init?.body)) as unknown),
			}).toStrictEqual({
				footnote: null,
				posts: [{sessionId: SESSION_ID, toolUseId: "toolu_question", answers: [{selected: [1]}]}],
			});
		});

		it.each([
			{name: "herdr writes are off", herdr: {panes: [herdrPane], writesEnabled: false}},
			{name: "the session has no live herdr pane", herdr: {panes: [], writesEnabled: true}},
		])("keeps the card read-only when $name", async ({herdr}) => {
			const card = await renderWaitingQuestion(herdr);

			expect({
				footnote: card.queryByText("Answer in the terminal") !== null,
				option: card.getByRole<HTMLButtonElement>("button", {name: /^No/}).disabled,
			}).toStrictEqual({footnote: true, option: true});
		});
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
