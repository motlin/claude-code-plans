import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {openAppDb, openTestDb} from "../src/lib/db/connection";
import {
	getCurrentSessionMessageIndex,
	getSessionViewedState,
	getUnseenSessionIds,
	linkHerdrTerminalToSession,
	markSessionCompletionUnreviewed,
	markSessionReviewed,
	markSessionUnreviewed,
	setHerdrTerminalViewed,
} from "../src/lib/db/viewed-state";
import * as schema from "../src/lib/db/schema";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import {buildSessionSummaryPayloadFromDb} from "../src/lib/session-summary";
import {applySessionViewedAction} from "../src/lib/session-viewed-action";
import {DOMAIN_EVENTS} from "../src/lib/hook-events";

function idleActiveSession(sessionId: string): ActiveSessionEntry {
	return {
		sessionId,
		state: "idle",
		cwd: "/tmp/test/project",
		model: "claude-test-model",
		startedAt: 1_000,
		lastActivity: 2_000,
		claudeEnv: {},
		tmuxPane: "",
		tmuxServerSocket: "",
		herdrPane: "",
		herdrWorkspace: "",
		herdrSocketPath: "",
		lastSubagentActivityAt: null,
		backgroundTasks: [],
	};
}

describe("durable session viewed state", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, {recursive: true, force: true});
		}
	});

	it("derives the current message index from the indexed messageCount without reading the transcript", () => {
		const cases = [
			{sessionId: "session-missing", messageCount: null, expectedMessageIndex: -1},
			{sessionId: "session-empty", messageCount: 0, expectedMessageIndex: -1},
			{sessionId: "session-two-messages", messageCount: 2, expectedMessageIndex: 1},
			{sessionId: "session-many-messages", messageCount: 40, expectedMessageIndex: 39},
		];
		const db = openTestDb();

		try {
			for (const testCase of cases) {
				if (testCase.messageCount === null) continue;
				db.index
					.insert(schema.sessions)
					.values({
						id: testCase.sessionId,
						projectId: "project-test-100",
						title: "Test session",
						messageCount: testCase.messageCount,
						isSidechain: 0,
						createdAt: 1_000,
						mtimeMs: 2_000,
						filePath: join("/nonexistent", `${testCase.sessionId}.jsonl`),
					})
					.run();
			}

			expect(
				cases.map((testCase) => ({
					sessionId: testCase.sessionId,
					messageIndex: getCurrentSessionMessageIndex(db.index, testCase.sessionId),
				})),
			).toStrictEqual(
				cases.map((testCase) => ({
					sessionId: testCase.sessionId,
					messageIndex: testCase.expectedMessageIndex,
				})),
			);
		} finally {
			db.close();
		}
	});

	it("raises review only on completion or an explicit action and merges herdr as a weak positive", () => {
		const db = openTestDb();
		try {
			markSessionReviewed(db.index, "session-test-100", 5, 1_000);
			const afterOutput = getSessionViewedState(db.index, "session-test-100", 7);
			markSessionCompletionUnreviewed(db.index, "session-test-100", 7, 2_000);
			const afterCompletion = getSessionViewedState(db.index, "session-test-100", 7);
			setHerdrTerminalViewed(db.index, "terminal-test-100", "session-test-100", true, 3_000);
			const afterHerdrView = getSessionViewedState(db.index, "session-test-100", 9);
			markSessionUnreviewed(db.index, "session-test-100", 9, 4_000);
			const afterManualUnreview = getSessionViewedState(db.index, "session-test-100", 9);

			expect({
				afterOutput,
				afterCompletion,
				afterHerdrView,
				afterManualUnreview,
			}).toStrictEqual({
				afterOutput: {
					currentMessageIndex: 7,
					lastViewedMessageIndex: 5,
					reviewTargetMessageIndex: 5,
					newMessageCount: 2,
					viewedInCcp: true,
					viewedInHerdr: false,
					viewedAnywhere: true,
				},
				afterCompletion: {
					currentMessageIndex: 7,
					lastViewedMessageIndex: 5,
					reviewTargetMessageIndex: 7,
					newMessageCount: 2,
					viewedInCcp: false,
					viewedInHerdr: false,
					viewedAnywhere: false,
				},
				afterHerdrView: {
					currentMessageIndex: 9,
					lastViewedMessageIndex: 5,
					reviewTargetMessageIndex: 7,
					newMessageCount: 4,
					viewedInCcp: false,
					viewedInHerdr: true,
					viewedAnywhere: true,
				},
				afterManualUnreview: {
					currentMessageIndex: 9,
					lastViewedMessageIndex: 5,
					reviewTargetMessageIndex: 9,
					newMessageCount: 4,
					viewedInCcp: false,
					viewedInHerdr: false,
					viewedAnywhere: false,
				},
			});
		} finally {
			db.close();
		}
	});

	it("lists exactly the sessions whose durable state is unseen", () => {
		const db = openTestDb();
		try {
			markSessionReviewed(db.index, "session-test-seen", 3, 1_000);
			markSessionCompletionUnreviewed(db.index, "session-test-unseen", 3, 1_000);
			markSessionCompletionUnreviewed(db.index, "session-test-herdr", 3, 1_000);
			setHerdrTerminalViewed(db.index, "terminal-test-100", "session-test-herdr", true, 2_000);

			expect([...getUnseenSessionIds(db.index)]).toStrictEqual(["session-test-unseen"]);
		} finally {
			db.close();
		}
	});

	it("feeds unseen into the bucket: dwell viewing moves review to done and marking unseen moves it back", () => {
		const db = openTestDb();
		const sessionId = "session-test-300";
		try {
			db.index
				.insert(schema.sessions)
				.values({
					id: sessionId,
					projectId: "project-test-300",
					title: "Test session",
					messageCount: 4,
					isSidechain: 0,
					createdAt: 1_000,
					mtimeMs: 2_000,
					filePath: join("/nonexistent", `${sessionId}.jsonl`),
				})
				.run();
			const observe = () => {
				const payload = buildSessionSummaryPayloadFromDb(db.index, sessionId, () =>
					idleActiveSession(sessionId),
				);
				return {unseen: payload?.unseen, bucket: payload?.bucket};
			};

			const initial = observe();
			markSessionCompletionUnreviewed(db.index, sessionId, 3, 1_000);
			const afterCompletion = observe();
			markSessionReviewed(db.index, sessionId, 3, 2_000);
			const afterDwell = observe();
			markSessionUnreviewed(db.index, sessionId, 3, 3_000);
			const afterMarkUnseen = observe();

			expect({initial, afterCompletion, afterDwell, afterMarkUnseen}).toStrictEqual({
				initial: {unseen: false, bucket: "done"},
				afterCompletion: {unseen: true, bucket: "review"},
				afterDwell: {unseen: false, bucket: "done"},
				afterMarkUnseen: {unseen: true, bucket: "review"},
			});
		} finally {
			db.close();
		}
	});

	it("broadcasts the server truth so every tab agrees after a viewed-state action", () => {
		const db = openTestDb();
		const sessionId = "session-test-400";
		try {
			db.index
				.insert(schema.sessions)
				.values({
					id: sessionId,
					projectId: "project-test-400",
					title: "Test session",
					messageCount: 4,
					isSidechain: 0,
					createdAt: 1_000,
					mtimeMs: 2_000,
					filePath: join("/nonexistent", `${sessionId}.jsonl`),
				})
				.run();
			const broadcasts: Array<{type: string; unseen: unknown; bucket: unknown}> = [];
			const broadcast = (type: string, data: Record<string, unknown>) => {
				const session = data["session"] as {unseen: unknown; bucket: unknown};
				broadcasts.push({type, unseen: session.unseen, bucket: session.bucket});
			};
			const activeSession = () => idleActiveSession(sessionId);

			const unreviewed = applySessionViewedAction({
				db: db.index,
				sessionId,
				action: "unreviewed",
				broadcast,
				activeSessionLookup: activeSession,
			});
			const reviewed = applySessionViewedAction({
				db: db.index,
				sessionId,
				action: "reviewed",
				broadcast,
				activeSessionLookup: activeSession,
			});

			expect({
				unreviewed: {
					currentMessageIndex: unreviewed.currentMessageIndex,
					viewedAnywhere: unreviewed.viewedAnywhere,
				},
				reviewed: {
					currentMessageIndex: reviewed.currentMessageIndex,
					viewedAnywhere: reviewed.viewedAnywhere,
				},
				broadcasts,
			}).toStrictEqual({
				unreviewed: {currentMessageIndex: 3, viewedAnywhere: false},
				reviewed: {currentMessageIndex: 3, viewedAnywhere: true},
				broadcasts: [
					{type: DOMAIN_EVENTS.SESSION_UPDATED, unseen: true, bucket: "review"},
					{type: DOMAIN_EVENTS.SESSION_UPDATED, unseen: false, bucket: "done"},
				],
			});
		} finally {
			db.close();
		}
	});

	it("survives a SQLite close and reopen with the exact message index", () => {
		const cacheDirectory = mkdtempSync(join(tmpdir(), "viewed-state-test-"));
		temporaryDirectories.push(cacheDirectory);
		const projectDirectory = join(cacheDirectory, "project-test");
		mkdirSync(projectDirectory);
		const transcriptPath = join(projectDirectory, "session-test-200.jsonl");
		writeFileSync(
			transcriptPath,
			[
				JSON.stringify({type: "user", message: {content: "Alice test prompt"}}),
				JSON.stringify({type: "assistant", message: {content: "Bob test response"}}),
				JSON.stringify({type: "system", subtype: "turn_duration", durationMs: 100}),
				"",
			].join("\n"),
		);

		const first = openAppDb({cacheDir: cacheDirectory});
		first.index
			.insert(schema.sessions)
			.values({
				id: "session-test-200",
				projectId: "project-test-200",
				title: "Test session",
				messageCount: 2,
				isSidechain: 0,
				createdAt: 1_000,
				mtimeMs: 2_000,
				filePath: transcriptPath,
			})
			.run();
		const messageIndex = getCurrentSessionMessageIndex(first.index, "session-test-200");
		markSessionReviewed(first.index, "session-test-200", messageIndex, 3_000);
		linkHerdrTerminalToSession(first.index, "terminal-test-200", "session-test-200", 4_000);
		setHerdrTerminalViewed(first.index, "terminal-test-200", "session-test-200", true, 5_000);
		first.close();

		const reopened = openAppDb({cacheDir: cacheDirectory});
		try {
			expect({
				messageIndex: getCurrentSessionMessageIndex(reopened.index, "session-test-200"),
				viewedState: getSessionViewedState(reopened.index, "session-test-200", messageIndex),
			}).toStrictEqual({
				// messageCount is 2, so the last message index is 1; the system
				// record in the transcript does not count.
				messageIndex: 1,
				viewedState: {
					currentMessageIndex: 1,
					lastViewedMessageIndex: 1,
					reviewTargetMessageIndex: 1,
					newMessageCount: 0,
					viewedInCcp: true,
					viewedInHerdr: true,
					viewedAnywhere: true,
				},
			});
		} finally {
			reopened.close();
		}
	});
});
