// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionHoverCard} from "../src/components/session-hover-card";
import {approvalsQueryOptions} from "../src/lib/api/approvals";
import {herdrPanesQueryOptions} from "../src/lib/api/herdr";
import {pendingQuestionQueryOptions} from "../src/lib/api/pending-question";
import {recentSessionsInfiniteQueryOptions} from "../src/lib/api/sessions";

const QUESTION_APPROVAL = {
	sessionId: "blocked-1",
	projectId: "-projects-alpha",
	projectName: "alpha",
	toolName: "AskUserQuestion" as const,
	toolUseId: "toolu_ask",
	blockedSince: "2026-09-29T11:00:00.000Z",
	planFilename: null,
	questionPreview: "Which database should we use?",
	questionOptions: ["Postgres", "SQLite"],
};

const BLOCKED_PANE = {
	paneId: "w1:p1",
	terminalId: "terminal-1",
	workspaceId: "w1",
	tabId: "w1:t1",
	focused: false,
	cwd: "/projects/alpha",
	foregroundCwd: "/projects/alpha",
	agentStatus: "blocked",
	agent: "claude",
	terminalTitle: null,
	agentSessionId: "blocked-1",
	revision: 1,
	sessionId: "blocked-1",
	via: "agent-session" as const,
	viewedState: null,
};

/** The blocked session's state in the session list and its herdr panes. */
interface SessionEnvironment {
	state: "waiting" | "ended";
	panes: (typeof BLOCKED_PANE)[];
}

const LIVE_IN_PANE: SessionEnvironment = {state: "waiting", panes: [BLOCKED_PANE]};

function renderCard(
	props: {sessionId: string; title: string; summary: string | null; blocked: boolean; aiTitle?: string | null},
	approvals: (typeof QUESTION_APPROVAL)[] = [],
	environment: SessionEnvironment = LIVE_IN_PANE,
) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(approvalsQueryOptions().queryKey, {approvals});
	queryClient.setQueryData(herdrPanesQueryOptions.queryKey, {panes: environment.panes, writesEnabled: true} as never);
	queryClient.setQueryData(recentSessionsInfiniteQueryOptions().queryKey, {
		pages: [{sessions: [{id: props.sessionId, state: environment.state}], nextCursor: null}],
		pageParams: [null],
	} as never);
	queryClient.setQueryData(pendingQuestionQueryOptions(props.sessionId).queryKey, {
		pendingQuestion: {
			toolUseId: "toolu_ask",
			questions: [
				{question: "Which database should we use?", options: [{label: "Postgres"}, {label: "SQLite"}]},
				{question: "Add an ORM?", options: [{label: "Yes"}, {label: "No"}]},
			],
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<SessionHoverCard {...props} onOpen={() => undefined} render={<div data-testid="row" />}>
				{props.title}
			</SessionHoverCard>
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

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

function card(): HTMLElement | null {
	return document.querySelector("[data-session-hover-card]");
}

beforeAll(async () => {
	// Quick replies load the submit module on demand; warm it so a reply posts within one tick.
	await import("../src/lib/question-answer-submit");
});

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("SessionHoverCard", () => {
	it("opens a 440px card for blocked rows after 400ms", async () => {
		renderCard({sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true}, [QUESTION_APPROVAL]);
		hover();
		await advance(399);
		expect(card()).toBeNull();
		await advance(1);
		expect({
			kind: card()?.getAttribute("data-kind"),
			width: card()?.style.width,
		}).toStrictEqual({kind: "blocked", width: "440px"});
	});

	it("opens a 340px card for other rows after 500ms", async () => {
		renderCard({
			sessionId: "done-1",
			title: "Refactor parser",
			summary: "Split the tokenizer out of the parser.",
			blocked: false,
		});
		hover();
		await advance(499);
		expect(card()).toBeNull();
		await advance(1);
		expect({
			kind: card()?.getAttribute("data-kind"),
			width: card()?.style.width,
			title: card()?.querySelector("[data-card-title]")?.textContent,
			summary: card()?.querySelector("[data-card-summary]")?.textContent,
		}).toStrictEqual({
			kind: "other",
			width: "340px",
			title: "Refactor parser",
			summary: "Split the tokenizer out of the parser.",
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
		expect({
			title: card()?.querySelector("[data-card-title]")?.textContent,
			aiTitle: card()?.querySelector("[data-card-ai-title]")?.textContent,
		}).toStrictEqual({title: "claude.ai", aiTitle: "Parallel do-task workstreams"});
	});

	it("omits the AI title line without an AI title", async () => {
		renderCard({sessionId: "done-1", title: "Refactor parser", summary: null, blocked: false});
		hover();
		await advance(500);
		expect(card()?.querySelector("[data-card-ai-title]")).toBeNull();
	});

	it("shows the pending question with its options and a quick reply box", async () => {
		renderCard({sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true}, [QUESTION_APPROVAL]);
		hover();
		await advance(400);
		const root = card()!;
		expect({
			title: root.querySelector("[data-card-title]")?.textContent,
			question: root.querySelector("[data-card-question]")?.textContent,
			options: Array.from(root.querySelectorAll("[data-card-option]"), (b) => b.textContent),
			reply: root.querySelector("textarea")?.getAttribute("aria-label"),
			note: root.querySelector("[data-card-note]")?.textContent,
		}).toStrictEqual({
			title: "Pick a DB",
			question: "Which database should we use?",
			options: ["Postgres", "SQLite"],
			reply: "Quick reply",
			note: "Quick reply and approval controls available",
		});
	});

	function stubFetch() {
		const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url: string) =>
			Promise.resolve(
				url === "/api/herdr/question" ? Response.json({ok: true}) : new Response("", {status: 200}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		// The card's herdr pane query refetches on mount; only the answer POSTs matter here.
		return () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
	}

	it("types an option into the live session's pane, skipping its other questions", async () => {
		const posts = stubFetch();
		renderCard({sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true}, [QUESTION_APPROVAL]);
		hover();
		await advance(400);
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "SQLite"}));
		});
		await advance(0);
		expect(posts().map(([url, init]) => [url, init?.method, init?.body])).toStrictEqual([
			[
				"/api/herdr/question",
				"POST",
				JSON.stringify({sessionId: "blocked-1", toolUseId: "toolu_ask", answers: [{selected: [1]}, null]}),
			],
		]);
		expect(card()?.querySelector("[data-card-sent]")?.textContent).toBe("Reply sent");
	});

	it("types a quick reply into the live pane as Other text on Enter", async () => {
		const posts = stubFetch();
		renderCard({sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true}, [QUESTION_APPROVAL]);
		hover();
		await advance(400);
		const reply = screen.getByRole("textbox", {name: "Quick reply"});
		act(() => {
			fireEvent.change(reply, {target: {value: "  Use DuckDB  "}});
			fireEvent.keyDown(reply, {key: "Enter"});
		});
		await advance(0);
		expect(posts().map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/herdr/question",
				JSON.stringify({
					sessionId: "blocked-1",
					toolUseId: "toolu_ask",
					answers: [{selected: [], other: "Use DuckDB"}, null],
				}),
			],
		]);
	});

	it("is read-only for a live session without a pane, posting nothing", async () => {
		const posts = stubFetch();
		renderCard({sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true}, [QUESTION_APPROVAL], {
			state: "waiting",
			panes: [],
		});
		hover();
		await advance(400);
		const root = card()!;
		expect({
			hint: root.querySelector("[data-card-read-only]")?.textContent,
			options: root.querySelectorAll("[data-card-option]").length,
			reply: root.querySelector("textarea"),
			posts: posts(),
		}).toStrictEqual({hint: "Answer in the terminal", options: 0, reply: null, posts: []});
	});

	it("answers a stopped session in a fork, saying so on the card", async () => {
		const posts = stubFetch();
		renderCard({sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true}, [QUESTION_APPROVAL], {
			state: "ended",
			panes: [],
		});
		hover();
		await advance(400);
		expect({
			note: card()?.querySelector("[data-card-fork]")?.textContent,
			send: screen.queryByRole("button", {name: "Answer in a new fork"}) !== null,
		}).toStrictEqual({note: "Session stopped: replies answer in a new fork", send: true});
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "SQLite"}));
		});
		await advance(0);
		expect(posts().map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/answer-question",
				JSON.stringify({
					sessionId: "blocked-1",
					toolUseId: "toolu_ask",
					answers: [{question: "Which database should we use?", answer: "SQLite"}],
				}),
			],
		]);
	});

	it.each([
		{name: "with a writable pane", environment: LIVE_IN_PANE},
		{name: "without a pane", environment: {state: "waiting" as const, panes: []}},
	])("never posts /api/answer-question for a live session $name", async ({environment}) => {
		const posts = stubFetch();
		renderCard(
			{sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true},
			[QUESTION_APPROVAL],
			environment,
		);
		hover();
		await advance(400);
		for (const button of card()?.querySelectorAll("[data-card-option]") ?? []) {
			act(() => {
				fireEvent.click(button);
			});
		}
		await advance(0);
		expect(posts().filter(([url]) => url === "/api/answer-question")).toStrictEqual([]);
	});

	it("points blocked rows without an answerable question at the session", async () => {
		renderCard({sessionId: "blocked-2", title: "Needs a look", summary: null, blocked: true});
		hover();
		await advance(400);
		const root = card()!;
		expect({
			reply: root.querySelector("textarea"),
			open: screen.getByRole("button", {name: "Open session"}).textContent,
		}).toStrictEqual({reply: null, open: "Open session"});
	});
});
