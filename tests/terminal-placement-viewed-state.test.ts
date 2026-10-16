import {describe, expect, it} from "vite-plus/test";
import {openTestDb} from "../src/lib/db/connection";
import {markSessionCompletionUnreviewed, markSessionReviewed} from "../src/lib/db/viewed-state";
import {addViewedStateToTerminalPlacements} from "../src/lib/terminal-placement-viewed-state";
import type {TmuxTerminalPlacement} from "../src/lib/tmux-windows";

function tmuxPlacement(sessionId: string): TmuxTerminalPlacement {
	return {
		provider: "tmux",
		sessionId,
		displayName: "claude",
		active: false,
		paneHandle: "%1",
		scopeHandle: "/private/tmp/tmux-501/default",
		capabilities: {supportsWrite: false, supportsEvents: true, supportsObserve: false},
		tmuxWindow: {
			sessionId,
			projectName: "alice-project",
			windowIndex: 1,
			windowName: "claude",
			windowActive: false,
			tmuxPane: "%1",
			socket: "/private/tmp/tmux-501/default",
		},
	};
}

describe("terminal placement viewed state", () => {
	it("marks a tmux session unread after its Stop hook, with no herdr involved", () => {
		const db = openTestDb();
		try {
			markSessionReviewed(db.index, "session-test-done", 0, 1_000);
			markSessionCompletionUnreviewed(db.index, "session-test-unread", 0, 1_000);

			expect(
				addViewedStateToTerminalPlacements(db.index, [
					tmuxPlacement("session-test-unread"),
					tmuxPlacement("session-test-done"),
				]),
			).toStrictEqual([
				{
					...tmuxPlacement("session-test-unread"),
					viewedState: {
						currentMessageIndex: -1,
						lastViewedMessageIndex: -1,
						reviewTargetMessageIndex: 0,
						newMessageCount: 0,
						viewedInCcp: false,
						viewedInHerdr: false,
						viewedAnywhere: false,
					},
				},
				{
					...tmuxPlacement("session-test-done"),
					viewedState: {
						currentMessageIndex: -1,
						lastViewedMessageIndex: 0,
						reviewTargetMessageIndex: 0,
						newMessageCount: 0,
						viewedInCcp: true,
						viewedInHerdr: false,
						viewedAnywhere: true,
					},
				},
			]);
		} finally {
			db.close();
		}
	});
});
