import {describe, expect, it} from "vite-plus/test";
import type {HerdrPaneLink} from "../src/lib/herdr/panes";
import {
	compareHerdrAttention,
	createHerdrViewedStateTracker,
	isCompletionTransitionParts,
} from "../src/lib/herdr/viewed-state";

function pane(overrides: Partial<HerdrPaneLink>): HerdrPaneLink {
	return {
		paneId: "workspace-100:pane-100",
		terminalId: "terminal-test-100",
		workspaceId: "workspace-100",
		tabId: "workspace-100:tab-100",
		focused: false,
		cwd: "/tmp/test/project",
		foregroundCwd: "/tmp/test/project/src",
		agentStatus: "working",
		agent: "claude",
		terminalTitle: "Alice test terminal",
		agentSessionId: "session-test-100",
		revision: 100,
		sessionId: "session-test-100",
		via: "both",
		...overrides,
	};
}

describe("herdr viewed-state transitions", () => {
	it("recognizes only herdr completion transitions, including derived done", () => {
		const cases = [
			["working", "idle", "claude", "claude", true],
			["working", "done", "claude", "claude", true],
			["blocked", "idle", "claude", "claude", true],
			["unknown", "idle", "claude", "claude", true],
			["unknown", "idle", "claude", "codex", false],
			["unknown", "idle", null, null, false],
			["idle", "idle", "claude", "claude", false],
			["done", "idle", "claude", "claude", false],
			["working", "unknown", "claude", "claude", false],
		] as const;

		expect(
			cases.map(([previousStatus, nextStatus, previousAgent, nextAgent]) =>
				isCompletionTransitionParts(
					{status: previousStatus, agent: previousAgent},
					{status: nextStatus, agent: nextAgent},
				),
			),
		).toStrictEqual(cases.map((entry) => entry[4]));
	});

	it("latches done-to-idle by terminal id across a pane move and skips ccp clearing in view", async () => {
		const calls: Array<{type: string; terminalId?: string; sessionId: string}> = [];
		const record = (call: {type: string; terminalId?: string; sessionId: string}): void => {
			calls.push(call);
		};
		let visible = false;
		const tracker = createHerdrViewedStateTracker({
			isSessionVisible: () => visible,
			linkTerminal: (terminalId, sessionId) => record({type: "link", terminalId, sessionId}),
			pruneTerminalLinks: (sessionId) => record({type: "prune", sessionId}),
			markSessionCompletionUnreviewed: (sessionId) => record({type: "completion", sessionId}),
			markTerminalUnviewed: (terminalId, sessionId) => record({type: "terminal-unviewed", terminalId, sessionId}),
			markTerminalViewed: (terminalId, sessionId) => record({type: "terminal-viewed", terminalId, sessionId}),
		});

		await tracker.syncPanes([pane({agentStatus: "working"})]);
		await tracker.handleStatusEvent({
			pane_id: "workspace-100:pane-100",
			agent_status: "done",
			agent: "claude",
		});
		await tracker.syncPanes([
			pane({paneId: "workspace-200:pane-200", workspaceId: "workspace-200", agentStatus: "done"}),
		]);
		await tracker.handleStatusEvent({
			pane_id: "workspace-200:pane-200",
			agent_status: "idle",
			agent: "claude",
		});
		visible = true;
		await tracker.syncPanes([
			pane({
				paneId: "workspace-200:pane-200",
				workspaceId: "workspace-200",
				agentStatus: "working",
			}),
		]);
		await tracker.handleStatusEvent({
			pane_id: "workspace-200:pane-200",
			agent_status: "idle",
			agent: "claude",
		});

		expect(calls).toStrictEqual([
			{type: "link", terminalId: "terminal-test-100", sessionId: "session-test-100"},
			{type: "prune", sessionId: "session-test-100"},
			{
				type: "terminal-unviewed",
				terminalId: "terminal-test-100",
				sessionId: "session-test-100",
			},
			{type: "completion", sessionId: "session-test-100"},
			{type: "link", terminalId: "terminal-test-100", sessionId: "session-test-100"},
			{type: "prune", sessionId: "session-test-100"},
			{
				type: "terminal-viewed",
				terminalId: "terminal-test-100",
				sessionId: "session-test-100",
			},
			{type: "link", terminalId: "terminal-test-100", sessionId: "session-test-100"},
			{type: "prune", sessionId: "session-test-100"},
			{
				type: "terminal-unviewed",
				terminalId: "terminal-test-100",
				sessionId: "session-test-100",
			},
		]);
	});

	it("applies writes in call order even when an earlier write waits, and keeps going after a failure", async () => {
		const calls: string[] = [];
		let releaseLink: () => void = () => {};
		const tracker = createHerdrViewedStateTracker({
			isSessionVisible: () => true,
			linkTerminal: (terminalId) =>
				new Promise<void>((resolve) => {
					releaseLink = () => {
						calls.push(`link ${terminalId}`);
						resolve();
					};
				}),
			pruneTerminalLinks: () => {
				throw new Error("prune failed");
			},
			markSessionCompletionUnreviewed: () => {},
			markTerminalUnviewed: (terminalId) => {
				calls.push(`unviewed ${terminalId}`);
			},
			markTerminalViewed: () => {},
		});

		const synced = tracker.syncPanes([pane({agentStatus: "working"})]).catch((error: unknown) => error);
		const statusHandled = tracker.handleStatusEvent({
			pane_id: "workspace-100:pane-100",
			agent_status: "idle",
			agent: "claude",
		});
		await Promise.resolve();
		calls.push("released");
		releaseLink();

		expect({syncError: ((await synced) as Error).message, status: await statusHandled, calls}).toStrictEqual({
			syncError: "prune failed",
			status: undefined,
			calls: ["released", "link terminal-test-100", "unviewed terminal-test-100"],
		});
	});

	it("uses blocked, done, working, idle, unknown workspace attention ordering", () => {
		const panes = ["idle", "future-test-status", "working", "done", "blocked"].map((agentStatus, index) =>
			pane({agentStatus, terminalId: `terminal-test-${index * 100}`}),
		);
		panes.sort(compareHerdrAttention);

		expect(panes.map((entry) => entry.agentStatus)).toStrictEqual([
			"blocked",
			"done",
			"working",
			"idle",
			"future-test-status",
		]);
	});
});
