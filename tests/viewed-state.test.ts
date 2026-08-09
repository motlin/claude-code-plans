import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openAppDb, openTestDb } from "../src/lib/db/connection";
import {
  getCurrentSessionMessageIndex,
  getSessionViewedState,
  linkHerdrTerminalToSession,
  markSessionCompletionUnreviewed,
  markSessionReviewed,
  markSessionUnreviewed,
  setHerdrTerminalViewed,
} from "../src/lib/db/viewed-state";
import * as schema from "../src/lib/db/schema";

describe("durable session viewed state", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("derives the current message index from the indexed messageCount without reading the transcript", () => {
    const cases = [
      { sessionId: "session-missing", messageCount: null, expectedMessageIndex: -1 },
      { sessionId: "session-empty", messageCount: 0, expectedMessageIndex: -1 },
      { sessionId: "session-two-messages", messageCount: 2, expectedMessageIndex: 1 },
      { sessionId: "session-many-messages", messageCount: 40, expectedMessageIndex: 39 },
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

  it("survives a SQLite close and reopen with the exact message index", () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), "viewed-state-test-"));
    temporaryDirectories.push(cacheDirectory);
    const projectDirectory = join(cacheDirectory, "project-test");
    mkdirSync(projectDirectory);
    const transcriptPath = join(projectDirectory, "session-test-200.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: "user", message: { content: "Alice test prompt" } }),
        JSON.stringify({ type: "assistant", message: { content: "Bob test response" } }),
        JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 100 }),
        "",
      ].join("\n"),
    );

    const first = openAppDb({ cacheDir: cacheDirectory });
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

    const reopened = openAppDb({ cacheDir: cacheDirectory });
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
