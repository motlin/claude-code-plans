// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionHoverCard} from "../src/components/session-hover-card";
import {ToastProvider} from "../src/components/toast";
import {approvalsQueryOptions, type PendingApprovalItem} from "../src/lib/api/approvals";
import {herdrPanesQueryOptions, type HerdrPaneIndexData} from "../src/lib/api/herdr";
import {notificationsQueryOptions} from "../src/lib/api/notifications";
import {pendingQuestionQueryOptions} from "../src/lib/api/pending-question";
import {planQueryOptions, type PlanDetail} from "../src/lib/api/plans";
import {recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";
import {clearQuickReplyDraft, quickReplyDraftKey} from "../src/lib/awaiting-gate";
import type {PendingQuestion} from "../src/lib/hook-events";

const SESSION_ID = "blocked-1";

const QUESTION: PendingQuestion = {
	toolUseId: "toolu_ask",
	questions: [
		{
			question: "Which database should we use?",
			options: [{label: "**Postgres**"}, {label: "SQLite", description: "Embedded"}],
		},
	],
};

const PANE: HerdrPaneIndexData["panes"][number] = {
	paneId: "p1",
	terminalId: "t1",
	workspaceId: "w1",
	tabId: "tab1",
	focused: false,
	cwd: "/Users/alice/projects/alpha",
	foregroundCwd: null,
	agentStatus: "blocked",
	agent: "claude",
	terminalTitle: "claude",
	agentSessionId: SESSION_ID,
	revision: 1,
	sessionId: SESSION_ID,
	via: "env",
	viewedState: {
		currentMessageIndex: 3,
		lastViewedMessageIndex: 3,
		reviewTargetMessageIndex: 3,
		newMessageCount: 0,
		viewedInCcp: true,
		viewedInHerdr: false,
		viewedAnywhere: true,
	},
};

const PLAN: PlanDetail = {
	markdown: "# Ship the rail\n\nBuild the **cards** first.\n",
	mtime: "2026-10-16T00:00:00.000Z",
	title: "Ship the rail",
};

interface Seed {
	pendingQuestion?: PendingQuestion | null;
	approvals?: PendingApprovalItem[];
	writable?: boolean;
	permission?: string;
	/** The session's state in the session list; an ended session without a pane answers in a fork. */
	state?: "waiting" | "ended";
}

function renderCard(
	props: {sessionId?: string; title: string; summary: string | null; blocked: boolean; aiTitle?: string | null},
	seed: Seed = {},
) {
	const sessionId = props.sessionId ?? SESSION_ID;
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals: seed.approvals ?? []});
	queryClient.setQueryData(pendingQuestionQueryOptions(sessionId).queryKey, {
		pendingQuestion: seed.pendingQuestion ?? null,
	});
	if (seed.state !== undefined) {
		queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
			pages: [{sessions: [{id: sessionId, state: seed.state}], nextCursor: null}],
			pageParams: [null],
		} as never);
	}
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {
		panes: seed.writable === true ? [PANE] : [],
		writesEnabled: seed.writable === true,
	});
	queryClient.setQueryData(planQueryOptions("brave-plan").queryKey, PLAN);
	queryClient.setQueryData(notificationsQueryOptions().queryKey, {
		notifications:
			seed.permission === undefined
				? []
				: [
						{
							id: "n1",
							sessionId,
							projectId: "-projects-alpha",
							projectName: "alpha",
							message: seed.permission,
							notificationType: "permission_prompt",
							createdAt: 1,
							createdAtIso: "2026-10-16T00:00:00.000Z",
							unread: true,
						},
					],
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<SessionHoverCard {...props} sessionId={sessionId} render={<div data-testid="row" />}>
					{props.title}
				</SessionHoverCard>
			</ToastProvider>
		</QueryClientProvider>,
	);
}

function hover() {
	const row = screen.getByTestId("row");
	act(() => {
		fireEvent.pointerEnter(row, {pointerType: "mouse"});
		fireEvent.mouseEnter(row);
		fireEvent.mouseMove(row);
	});
}

function leave() {
	const row = screen.getByTestId("row");
	act(() => {
		fireEvent.pointerLeave(row, {pointerType: "mouse"});
		fireEvent.mouseLeave(row);
	});
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

function card(): HTMLElement | null {
	return document.querySelector("[data-session-hover-card]");
}

function text(selector: string): string | null {
	return card()?.querySelector(selector)?.textContent ?? null;
}

function replyBox(): HTMLTextAreaElement {
	const box = screen.getByRole("textbox", {name: "Reply to Claude"});
	if (!(box instanceof HTMLTextAreaElement)) throw new Error("no reply box");
	return box;
}

/** The writes a card sent; seeded reads may still refetch in the background. */
function posts(fetchMock: ReturnType<typeof okFetch>) {
	return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

function okFetch() {
	const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
		Promise.resolve(new Response(JSON.stringify({ok: true}), {status: 200})),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

beforeAll(async () => {
	// The awaiting body is a lazy chunk and answers load their submit module; warm both so fake timers only wait on the open delay.
	await import("../src/components/session-awaiting-body");
	await import("../src/lib/question-answer-submit");
});

beforeEach(() => {
	vi.useFakeTimers();
	clearQuickReplyDraft(quickReplyDraftKey(SESSION_ID, "Which database should we use?"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("SessionHoverCard timing and shell", () => {
	it("opens a fixed 440px awaiting card for a Needs input row after 400ms, labelled by its title", async () => {
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: true});
		hover();
		await advance(399);
		const early = card();
		await advance(1);
		const root = card();
		const titleId = root?.getAttribute("aria-labelledby") ?? "";

		expect({
			early,
			kind: root?.getAttribute("data-kind"),
			role: root?.getAttribute("role"),
			title: document.getElementById(titleId)?.textContent,
			width: root?.className.split(" ").filter((c) => c.startsWith("[--preview-card")),
		}).toStrictEqual({
			early: null,
			kind: "blocked",
			role: "group",
			title: "Pick a DB",
			width: ["[--preview-card-min-w:440px]", "[--preview-card-max-w:440px]"],
		});
	});

	it("opens a 340px summary card for other rows after 500ms, and closes 200ms after leaving", async () => {
		renderCard({
			sessionId: "done-1",
			title: "Refactor parser",
			summary: "Split the tokenizer out.",
			blocked: false,
		});
		hover();
		await advance(499);
		const early = card();
		await advance(1);
		const opened = {
			kind: card()?.getAttribute("data-kind"),
			width: card()
				?.className.split(" ")
				.filter((c) => c.startsWith("[--preview-card")),
			title: text("[data-card-title]"),
			summary: text("[data-card-summary]"),
		};
		leave();
		await advance(150);
		const stillOpen = card() !== null;

		expect({early, opened, stillOpen}).toStrictEqual({
			early: null,
			opened: {
				kind: "other",
				width: ["[--preview-card-min-w:340px]", "[--preview-card-max-w:340px]"],
				title: "Refactor parser",
				summary: "Split the tokenizer out.",
			},
			stillOpen: true,
		});
	});

	it("shows the AI title as a muted line under a renamed title", async () => {
		renderCard({
			sessionId: "done-1",
			title: "claude.ai",
			aiTitle: "Parallel do-task workstreams",
			summary: null,
			blocked: false,
		});
		hover();
		await advance(500);

		expect({title: text("[data-card-title]"), aiTitle: text("[data-card-ai-title]")}).toStrictEqual({
			title: "claude.ai",
			aiTitle: "Parallel do-task workstreams",
		});
	});

	it("shows no card for a row with nothing to summarise, as upstream's plain Completed rows", async () => {
		renderCard({sessionId: "done-1", title: "Refactor parser", summary: null, blocked: false});
		hover();
		await advance(600);

		expect(card()).toBeNull();
	});
});

describe("SessionHoverCard question gate", () => {
	it("offers the options as chips and a reply box when the live pane is writable", async () => {
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: true});
		hover();
		await advance(400);
		const reply = replyBox();
		const send = screen.getByRole("button", {name: "Send reply"});

		expect({
			interactive: card()?.hasAttribute("data-interactive"),
			pointer: card()?.className.includes("pointer-events-none"),
			asked: text("[data-card-question]"),
			chips: [...(card()?.querySelectorAll("[data-card-option]") ?? [])].map((chip) => chip.textContent),
			placeholder: reply.getAttribute("placeholder"),
			describedBy: document.getElementById(reply.getAttribute("aria-describedby") ?? "")?.textContent,
			sendDisabled: send.hasAttribute("disabled"),
			keys: send.getAttribute("aria-keyshortcuts"),
		}).toStrictEqual({
			interactive: true,
			pointer: false,
			asked: "Claude asked · Which database should we use?",
			chips: ["Postgres", "SQLite"],
			placeholder: "Reply to Claude…",
			describedBy: "Which database should we use?",
			sendDisabled: true,
			keys: "Enter",
		});
	});

	it("answers with a chip through the herdr question endpoint", async () => {
		const fetchMock = okFetch();
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: true});
		hover();
		await advance(400);
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "SQLite"}));
		});
		await advance(0);

		expect(posts(fetchMock).map(([url, init]) => [url, init?.method, init?.body])).toStrictEqual([
			[
				"/api/herdr/question",
				"POST",
				JSON.stringify({sessionId: SESSION_ID, toolUseId: "toolu_ask", answers: [{selected: [1]}]}),
			],
		]);
	});

	it("sends typed text as the Other answer on Enter, and Shift+Enter keeps typing", async () => {
		const fetchMock = okFetch();
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: true});
		hover();
		await advance(400);
		const reply = replyBox();
		act(() => {
			fireEvent.change(reply, {target: {value: "  Use DuckDB  "}});
			fireEvent.keyDown(reply, {key: "Enter", shiftKey: true});
		});
		const afterShift = posts(fetchMock).length;
		act(() => {
			fireEvent.keyDown(reply, {key: "Enter"});
		});
		await advance(0);

		expect({afterShift, bodies: posts(fetchMock).map(([, init]) => init?.body)}).toStrictEqual({
			afterShift: 0,
			bodies: [
				JSON.stringify({
					sessionId: SESSION_ID,
					toolUseId: "toolu_ask",
					answers: [{selected: [], other: "Use DuckDB"}],
				}),
			],
		});
	});

	it("keeps an unsent reply when the card closes and reopens", async () => {
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: true});
		hover();
		await advance(400);
		act(() => {
			fireEvent.change(replyBox(), {target: {value: "half a thought"}});
		});
		leave();
		await advance(1000);
		const closed = card();
		hover();
		await advance(400);

		expect({closed, restored: replyBox().value}).toStrictEqual({closed: null, restored: "half a thought"});
	});

	it("restores the reply and toasts when sending fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<() => Promise<Response>>(async () =>
				Promise.resolve(new Response(JSON.stringify({error: "pane moved on"}), {status: 409})),
			),
		);
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: true});
		hover();
		await advance(400);
		act(() => {
			fireEvent.change(replyBox(), {target: {value: "Use DuckDB"}});
			fireEvent.keyDown(replyBox(), {key: "Enter"});
		});
		await advance(0);

		expect({
			value: replyBox().value,
			toast: screen.getByText("Response couldn’t be sent. You can try again.").tagName,
		}).toStrictEqual({value: "Use DuckDB", toast: "P"});
	});

	it("points at the session without a writable pane, and keeps the pointer out", async () => {
		renderCard({title: "Pick a DB", summary: null, blocked: true}, {pendingQuestion: QUESTION, writable: false});
		hover();
		await advance(400);

		expect({
			interactive: card()?.hasAttribute("data-interactive"),
			pointer: card()?.className.includes("pointer-events-none"),
			asked: text("[data-card-question]"),
			footer: text("[data-card-footer]"),
			chips: card()?.querySelectorAll("[data-card-option]").length,
			reply: card()?.querySelector("textarea") ?? null,
		}).toStrictEqual({
			interactive: false,
			pointer: true,
			asked: "Claude asked · Which database should we use?",
			footer: "Open the session to respond",
			chips: 0,
			reply: null,
		});
	});

	it("answers a stopped session in a fork, saying so on the card", async () => {
		const fetchMock = okFetch();
		renderCard(
			{title: "Pick a DB", summary: null, blocked: true},
			{pendingQuestion: QUESTION, writable: false, state: "ended"},
		);
		hover();
		await advance(400);
		const fork = {
			interactive: card()?.hasAttribute("data-interactive"),
			note: text("[data-card-fork]"),
			send: screen.queryByRole("button", {name: "Answer in a new fork"}) !== null,
		};
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "SQLite"}));
		});
		await advance(0);

		expect({fork, posts: posts(fetchMock).map(([url, init]) => [url, init?.body])}).toStrictEqual({
			fork: {interactive: true, note: "Session stopped: replies answer in a new fork", send: true},
			posts: [
				[
					"/api/answer-question",
					JSON.stringify({
						sessionId: SESSION_ID,
						toolUseId: "toolu_ask",
						answers: [{question: "Which database should we use?", answer: "SQLite"}],
					}),
				],
			],
		});
	});

	it("counts several questions with upstream's open-to-answer footer", async () => {
		const first = QUESTION.questions[0]!;
		renderCard(
			{title: "Pick a DB", summary: null, blocked: true},
			{
				pendingQuestion: {toolUseId: "toolu_ask", questions: [first, {...first, question: "And the cache?"}]},
				writable: true,
			},
		);
		hover();
		await advance(400);

		expect({
			asked: text("[data-card-question]"),
			footer: text("[data-card-footer]"),
			reply: card()?.querySelector("textarea") ?? null,
			interactive: card()?.hasAttribute("data-interactive"),
		}).toStrictEqual({
			asked: "Claude asked · Which database should we use?\nAnd the cache?",
			footer: "2 questions — open to answer",
			reply: null,
			interactive: false,
		});
	});
});

const PLAN_APPROVAL: PendingApprovalItem = {
	sessionId: SESSION_ID,
	projectId: "-projects-alpha",
	projectName: "alpha",
	toolName: "ExitPlanMode",
	toolUseId: "toolu_plan",
	blockedSince: "2026-10-16T00:00:00.000Z",
	planFilename: "brave-plan.md",
	questionPreview: null,
	questionOptions: [],
};

describe("SessionHoverCard plan, permission and no-gate cards", () => {
	it("shows a ready plan's headline and detail, pointing at the session to approve", async () => {
		renderCard({title: "Rail plan", summary: null, blocked: true}, {approvals: [PLAN_APPROVAL], writable: true});
		hover();
		await advance(400);

		expect({
			eyebrow: text("[data-card-question]"),
			detail: text("[data-card-detail]"),
			footer: text("[data-card-footer]"),
			interactive: card()?.hasAttribute("data-interactive"),
		}).toStrictEqual({
			eyebrow: "Plan ready · Ship the rail",
			detail: "Build the cards first.",
			footer: "Open the session to approve",
			interactive: false,
		});
	});

	it("allows a tool permission prompt in the live pane", async () => {
		const fetchMock = okFetch();
		renderCard(
			{title: "Run tests", summary: null, blocked: true},
			{permission: "Claude needs your permission to use Bash", writable: true},
		);
		hover();
		await advance(400);
		const buttons = [...(card()?.querySelectorAll("button") ?? [])].map((button) => button.textContent);
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "Allow once"}));
		});
		await advance(0);

		expect({
			asked: text("[data-card-question]"),
			buttons,
			interactive: card()?.hasAttribute("data-interactive"),
			posts: posts(fetchMock).map(([url, init]) => [url, init?.body]),
		}).toStrictEqual({
			asked: "Claude asked · Claude needs your permission to use Bash",
			buttons: ["Deny", "Allow once"],
			interactive: true,
			posts: [["/api/herdr/permission", JSON.stringify({sessionId: SESSION_ID, decision: "allow"})]],
		});
	});

	it("leaves a permission prompt to the session without a writable pane", async () => {
		renderCard(
			{title: "Run tests", summary: null, blocked: true},
			{permission: "Claude needs your permission to use Bash", writable: false},
		);
		hover();
		await advance(400);

		expect({
			footer: text("[data-card-footer]"),
			buttons: card()?.querySelectorAll("button").length,
			interactive: card()?.hasAttribute("data-interactive"),
		}).toStrictEqual({footer: "Open the session to respond", buttons: 0, interactive: false});
	});

	it("replies to a session waiting without a gate with a normal prompt", async () => {
		const fetchMock = okFetch();
		renderCard(
			{title: "Next step", summary: "Which branch should I rebase onto?", blocked: true},
			{writable: true},
		);
		hover();
		await advance(400);
		act(() => {
			fireEvent.change(replyBox(), {target: {value: "main"}});
			fireEvent.keyDown(replyBox(), {key: "Enter"});
		});
		await advance(0);

		expect({
			asked: text("[data-card-question]"),
			posts: posts(fetchMock).map(([url, init]) => [url, init?.body]),
		}).toStrictEqual({
			asked: "Claude asked · Which branch should I rebase onto?",
			posts: [["/api/herdr/prompt", JSON.stringify({sessionId: SESSION_ID, prompt: "main"})]],
		});
	});

	it("falls back to Awaiting input without a gate or a writable pane", async () => {
		renderCard({title: "Next step", summary: null, blocked: true}, {writable: false});
		hover();
		await advance(400);

		expect({
			body: card()?.querySelector("[data-card-fallback]")?.textContent,
			reply: card()?.querySelector("textarea") ?? null,
		}).toStrictEqual({body: "Awaiting inputOpen the session to respond", reply: null});
	});
});
