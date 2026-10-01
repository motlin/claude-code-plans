// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useQuery} from "@tanstack/react-query";
import {act, cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {useEffect, type ReactNode} from "react";
import {ClaudeEventsProvider, useSubscribeSessionRemovals} from "../src/hooks/use-claude-events";
import {sessionQueryKeys, transcriptQueryOptions, type TranscriptData} from "../src/lib/api/sessions";
import {DOMAIN_EVENTS, HERDR_EVENTS} from "../src/lib/hook-events";

class TestEventSource extends EventTarget {
	static current: TestEventSource | null = null;

	readonly close = vi.fn();
	onerror: ((event: Event) => void) | null = null;

	constructor(readonly url: string | URL) {
		super();
		TestEventSource.current = this;
	}

	emit(type: string, data: Record<string, unknown> = {}): void {
		this.dispatchEvent(new MessageEvent(type, {data: JSON.stringify(data)}));
	}

	/** A dropped connection followed by the browser's automatic reconnect. */
	reconnect(): void {
		this.onerror?.(new Event("error"));
		this.dispatchEvent(new Event("open"));
	}
}

function RemovalProbe({onRemoved}: {onRemoved: (sessionId: string) => void}): null {
	const subscribe = useSubscribeSessionRemovals();
	useEffect(() => subscribe(onRemoved), [subscribe, onRemoved]);
	return null;
}

function renderProvider(children: ReactNode = <div />): {
	client: QueryClient;
	eventSource: TestEventSource;
} {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	client.setQueryData(["terminal", "placements"], []);
	client.setQueryData(["tmux", "windows"], []);
	client.setQueryData(["herdr", "panes"], []);
	client.setQueryData(["herdr", "workspaces"], []);

	render(
		<QueryClientProvider client={client}>
			<ClaudeEventsProvider>{children}</ClaudeEventsProvider>
		</QueryClientProvider>,
	);

	const eventSource = TestEventSource.current;
	if (eventSource === null) throw new Error("Expected ClaudeEventsProvider to open EventSource");
	return {client, eventSource};
}

function invalidationState(client: QueryClient) {
	return {
		herdrPanes: client.getQueryState(["herdr", "panes"])?.isInvalidated,
		herdrWorkspaces: client.getQueryState(["herdr", "workspaces"])?.isInvalidated,
		terminalPlacements: client.getQueryState(["terminal", "placements"])?.isInvalidated,
		tmuxWindows: client.getQueryState(["tmux", "windows"])?.isInvalidated,
	};
}

describe("ClaudeEventsProvider terminal placement invalidation", () => {
	beforeEach(() => {
		TestEventSource.current = null;
		vi.stubGlobal("EventSource", TestEventSource);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("invalidates terminal placements and the legacy tmux query when a prompt is submitted", () => {
		const {client, eventSource} = renderProvider();

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED, {
				sessionId: "session-test-100",
			});
		});

		expect(invalidationState(client)).toStrictEqual({
			herdrPanes: false,
			herdrWorkspaces: false,
			terminalPlacements: true,
			tmuxWindows: true,
		});
	});

	it("invalidates terminal placements and the legacy tmux query on session lifecycle events", () => {
		const {client, eventSource} = renderProvider();

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_STARTED, {
				sessionId: "session-test-100",
			});
		});

		expect(invalidationState(client)).toStrictEqual({
			herdrPanes: false,
			herdrWorkspaces: false,
			terminalPlacements: true,
			tmuxWindows: true,
		});
	});

	it("invalidates terminal placements and both Herdr read models on Herdr events", () => {
		const {client, eventSource} = renderProvider();

		act(() => {
			eventSource.emit(HERDR_EVENTS.PANE_CREATED);
		});

		expect(invalidationState(client)).toStrictEqual({
			herdrPanes: true,
			herdrWorkspaces: true,
			terminalPlacements: true,
			tmuxWindows: false,
		});
	});

	it("tells session-removal subscribers which session the index dropped", () => {
		const removed: string[] = [];
		const {eventSource} = renderProvider(<RemovalProbe onRemoved={(sessionId) => removed.push(sessionId)} />);

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_REMOVED, {
				sessionId: "session-test-100",
				projectDir: "-Users-test-project",
			});
		});

		expect(removed).toStrictEqual(["session-test-100"]);
	});
});

describe("ClaudeEventsProvider SSE reconnect", () => {
	const SESSION_ID = "session-test-100";

	beforeEach(() => {
		TestEventSource.current = null;
		vi.stubGlobal("EventSource", TestEventSource);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("invalidates only the queries an event could have changed while disconnected", () => {
		const {client, eventSource} = renderProvider();
		const keys = {
			groupedSessions: sessionQueryKeys.grouped(5),
			recentSessions: sessionQueryKeys.recent(50),
			activeSessions: sessionQueryKeys.active(300_000),
			sessionDetail: sessionQueryKeys.detail(SESSION_ID),
			transcript: sessionQueryKeys.transcript(SESSION_ID),
			approvals: ["approvals"],
			notifications: ["notifications"],
			subagents: sessionQueryKeys.subagents(SESSION_ID),
			artifacts: sessionQueryKeys.artifacts(SESSION_ID),
			plans: ["plans"],
			localAccount: ["local-account"],
			applicationSettings: ["application-settings"],
			herdrPanes: ["herdr", "panes"],
		} as const;
		for (const key of Object.values(keys)) client.setQueryData(key, {});

		act(() => {
			eventSource.reconnect();
		});

		expect(
			Object.fromEntries(
				Object.entries(keys).map(([name, key]) => [name, client.getQueryState(key)?.isInvalidated]),
			),
		).toStrictEqual({
			groupedSessions: true,
			recentSessions: true,
			activeSessions: true,
			sessionDetail: true,
			transcript: true,
			approvals: true,
			notifications: true,
			subagents: false,
			artifacts: false,
			plans: false,
			localAccount: false,
			applicationSettings: false,
			herdrPanes: false,
		});
	});

	it("does not invalidate anything on the first open", () => {
		const {client, eventSource} = renderProvider();
		client.setQueryData(sessionQueryKeys.transcript(SESSION_ID), {});

		act(() => {
			eventSource.dispatchEvent(new Event("open"));
		});

		expect(client.getQueryState(sessionQueryKeys.transcript(SESSION_ID))?.isInvalidated).toBe(false);
	});

	it("catches the open transcript up on lines appended while disconnected", async () => {
		const record = (uuid: string) => ({uuid, type: "assistant"});
		const cached: TranscriptData = {
			records: [record("uuid-0"), record("uuid-1")],
			byteOffset: 0,
			startIndex: 0,
			precedingMessageCount: 0,
		};
		const tail: TranscriptData = {
			records: [record("uuid-1"), record("uuid-2")],
			byteOffset: 0,
			startIndex: 1,
			precedingMessageCount: 1,
		};
		const fetchMock = vi.fn<typeof fetch>(async () => Response.json(tail));
		vi.stubGlobal("fetch", fetchMock);

		function TranscriptProbe(): null {
			useQuery(transcriptQueryOptions(SESSION_ID));
			return null;
		}

		const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
		client.setQueryData(sessionQueryKeys.transcript(SESSION_ID), cached);
		render(
			<QueryClientProvider client={client}>
				<ClaudeEventsProvider>
					<TranscriptProbe />
				</ClaudeEventsProvider>
			</QueryClientProvider>,
		);
		expect(fetchMock).not.toHaveBeenCalled();

		act(() => {
			TestEventSource.current!.reconnect();
		});

		await waitFor(() => {
			expect(client.getQueryData(sessionQueryKeys.transcript(SESSION_ID))).toStrictEqual({
				records: [record("uuid-0"), record("uuid-1"), record("uuid-2")],
				byteOffset: 0,
				startIndex: 0,
				precedingMessageCount: 0,
			});
		});
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toStrictEqual([
			expect.stringContaining(`/api/sessions/${SESSION_ID}/transcript`),
		]);
	});
});

describe("ClaudeEventsProvider lines appended to a session", () => {
	const NOW = Date.parse("2026-09-30T12:00:00.000Z");
	const ACTIVE_KEY = sessionQueryKeys.active(300_000);

	function activeSession(sessionId: string, lastModified: number) {
		return {
			sessionId,
			projectDir: "-Users-test-project",
			projectName: "/Users/test/project",
			title: `Session ${sessionId}`,
			createdAt: NOW - 3_600_000,
			lastModified,
			state: "idle" as const,
			unseen: false,
			blockedSince: null,
		};
	}

	function listItem(id: string) {
		return {
			id,
			title: `Session ${id}`,
			mtime: "2026-09-29T12:00:00.000Z",
			created: "2026-09-29T11:00:00.000Z",
			project: "-Users-test-project",
			projectName: "/Users/test/project",
			messageCount: 4,
			archived: false,
			state: "ended" as const,
			bucket: "done" as const,
			liveAgentCount: 0,
			unseen: true,
			blockedSince: null,
		};
	}

	beforeEach(() => {
		TestEventSource.current = null;
		vi.stubGlobal("EventSource", TestEventSource);
		vi.spyOn(Date, "now").mockReturnValue(NOW);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("moves an already active session to the top with a fresh activity time instead of refetching", () => {
		const {client, eventSource} = renderProvider();
		client.setQueryData(ACTIVE_KEY, [
			activeSession("session-a", NOW - 1_000),
			activeSession("session-b", NOW - 9_000),
		]);

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {
				sessionId: "session-b",
				lines: [{type: "assistant"}],
			});
		});

		expect({
			data: client.getQueryData(ACTIVE_KEY),
			invalidated: client.getQueryState(ACTIVE_KEY)?.isInvalidated,
		}).toStrictEqual({
			data: [activeSession("session-b", NOW), activeSession("session-a", NOW - 1_000)],
			invalidated: false,
		});
	});

	it("adds a newly active session from its cached list row so the sidebar shows it without a refetch", () => {
		const {client, eventSource} = renderProvider();
		client.setQueryData(ACTIVE_KEY, [activeSession("session-a", NOW - 1_000)]);
		client.setQueryData(sessionQueryKeys.recent(50), {sessions: [listItem("session-new")], nextCursor: null});

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {sessionId: "session-new", lines: [{type: "user"}]});
		});

		expect({
			data: client.getQueryData(ACTIVE_KEY),
			invalidated: client.getQueryState(ACTIVE_KEY)?.isInvalidated,
		}).toStrictEqual({
			data: [
				{
					sessionId: "session-new",
					projectDir: "-Users-test-project",
					projectName: "/Users/test/project",
					title: "Session session-new",
					createdAt: Date.parse("2026-09-29T11:00:00.000Z"),
					lastModified: NOW,
					state: "unknown",
					unseen: true,
					blockedSince: null,
				},
				activeSession("session-a", NOW - 1_000),
			],
			invalidated: false,
		});
	});

	it("finds a newly active session's row in the grouped and infinite recent lists too", () => {
		const {client, eventSource} = renderProvider();
		client.setQueryData(ACTIVE_KEY, []);
		client.setQueryData(sessionQueryKeys.recentInfinite(), {
			pages: [{sessions: [listItem("session-paged")], nextCursor: null}],
			pageParams: [null],
		});
		client.setQueryData(sessionQueryKeys.grouped(5), [
			{
				project: "-Users-test-project",
				projectName: "/Users/test/project",
				sessionCount: 1,
				sessions: [listItem("session-grouped")],
			},
		]);

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {sessionId: "session-paged", lines: []});
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {sessionId: "session-grouped", lines: []});
		});

		expect({
			ids: client.getQueryData<Array<{sessionId: string}>>(ACTIVE_KEY)?.map((session) => session.sessionId),
			invalidated: client.getQueryState(ACTIVE_KEY)?.isInvalidated,
		}).toStrictEqual({ids: ["session-grouped", "session-paged"], invalidated: false});
	});

	it("refetches the active sessions when no cached list knows the newly active session", () => {
		const {client, eventSource} = renderProvider();
		client.setQueryData(ACTIVE_KEY, [activeSession("session-a", NOW - 1_000)]);

		act(() => {
			eventSource.emit(DOMAIN_EVENTS.SESSION_LINES_APPENDED, {sessionId: "session-unknown", lines: []});
		});

		expect(client.getQueryState(ACTIVE_KEY)?.isInvalidated).toBe(true);
	});
});
