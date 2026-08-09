import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexJsonlFile, indexSessionsIndex } from "../src/lib/db/indexer";
import { listRecentSessionsFromDb, getSessionMeta } from "../src/lib/db/queries";
import { getCurrentSessionMessageIndex, getSessionViewedState } from "../src/lib/db/viewed-state";
import { countMessageRecords, isCountableMessageRecord } from "../src/lib/message-count";
import { listSessions, readSession } from "../src/lib/sessions";
import * as schema from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const testDir = join(tmpdir(), "claude-message-count-test-" + process.pid);
const projectId = "-Users-craig-projects-app";
const sessionId = "session-count-100";

const baseFields = {
  timestamp: "1999-12-31T00:00:00.000Z",
  sessionId,
  parentUuid: null,
  isSidechain: false,
  userType: "external",
  cwd: "/Users/craig/projects/app",
  gitBranch: "main",
  version: "2.1.71",
  entrypoint: "cli",
};

/**
 * Fixture transcript with exactly 4 countable messages:
 * two user turns and two assistant turns. The tool-result-only user record,
 * the sidechain assistant record, and the non-message records must not count.
 */
const fixtureRecords: Record<string, unknown>[] = [
  {
    type: "user",
    ...baseFields,
    uuid: "uuid-1",
    message: { role: "user", content: "First user prompt" },
  },
  {
    type: "assistant",
    ...baseFields,
    uuid: "uuid-2",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "First assistant reply" },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
      ],
    },
  },
  {
    // Tool-result-only user record: not a message.
    type: "user",
    ...baseFields,
    uuid: "uuid-3",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }],
    },
  },
  {
    type: "user",
    ...baseFields,
    uuid: "uuid-4",
    message: { role: "user", content: [{ type: "text", text: "Second user prompt" }] },
  },
  {
    // Sidechain record: not a message.
    type: "assistant",
    ...baseFields,
    isSidechain: true,
    uuid: "uuid-5",
    message: { role: "assistant", content: [{ type: "text", text: "Sidechain reply" }] },
  },
  {
    type: "assistant",
    ...baseFields,
    uuid: "uuid-6",
    message: { role: "assistant", content: [{ type: "text", text: "Second assistant reply" }] },
  },
  // Non-message records: never counted.
  { type: "system", subtype: "turn_duration", durationMs: 1200, uuid: "uuid-7" },
  { type: "summary", summary: "A short summary", leafUuid: "uuid-6" },
];

const EXPECTED_MESSAGE_COUNT = 4;

function jsonl(...lines: Record<string, unknown>[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

let db: AppDb;

beforeEach(() => {
  mkdirSync(join(testDir, projectId), { recursive: true });
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

function writeFixtureTranscript(): string {
  const filePath = join(testDir, projectId, `${sessionId}.jsonl`);
  writeFileSync(filePath, jsonl(...fixtureRecords));
  return filePath;
}

describe("single message-count definition", () => {
  it("counts user and assistant turns, excluding tool-result records and sidechains", () => {
    expect(fixtureRecords.map((record) => isCountableMessageRecord(record))).toStrictEqual([
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
    expect(countMessageRecords(fixtureRecords)).toBe(EXPECTED_MESSAGE_COUNT);
  });

  it("every surface reports the same count for the fixture transcript", async () => {
    const filePath = writeFixtureTranscript();
    await indexJsonlFile(db.index, filePath, projectId);

    const row = db.index
      .select({ messageCount: schema.sessions.messageCount })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    const listEntry = listRecentSessionsFromDb(db.index, { limit: 10 }).sessions.find(
      (session) => session.id === sessionId,
    );
    const meta = getSessionMeta(db.index, sessionId);
    const detail = await readSession(testDir, sessionId);
    const filesystemGroups = await listSessions(testDir);
    const filesystemEntry = filesystemGroups
      .flatMap((group) => group.sessions)
      .find((session) => session.id === sessionId);

    expect({
      indexedCount: row?.messageCount,
      listCount: listEntry?.messageCount,
      metaCount: meta?.messageCount,
      detailCount: detail?.messageCount,
      filesystemCount: filesystemEntry?.messageCount,
    }).toStrictEqual({
      indexedCount: EXPECTED_MESSAGE_COUNT,
      listCount: EXPECTED_MESSAGE_COUNT,
      metaCount: EXPECTED_MESSAGE_COUNT,
      detailCount: EXPECTED_MESSAGE_COUNT,
      filesystemCount: EXPECTED_MESSAGE_COUNT,
    });
  });

  it("newMessageCount derives from the same counter and can never exceed messageCount", async () => {
    const filePath = writeFixtureTranscript();
    await indexJsonlFile(db.index, filePath, projectId);

    const currentIndex = getCurrentSessionMessageIndex(db.index, sessionId);
    const neverViewed = getSessionViewedState(db.index, sessionId, currentIndex);
    // A stored index from the legacy raw-record unit (larger than any message
    // index) must clamp instead of producing a bogus count.
    const legacy = getSessionViewedState(db.index, sessionId, 999);

    expect({
      currentIndex,
      neverViewedNewCount: neverViewed.newMessageCount,
      neverViewedWithinTotal: neverViewed.newMessageCount <= EXPECTED_MESSAGE_COUNT,
      legacyWithinTotal: legacy.newMessageCount <= 1000,
    }).toStrictEqual({
      currentIndex: EXPECTED_MESSAGE_COUNT - 1,
      neverViewedNewCount: EXPECTED_MESSAGE_COUNT,
      neverViewedWithinTotal: true,
      legacyWithinTotal: true,
    });
  });

  it("sessions-index.json counts never overwrite the transcript-derived count", async () => {
    const filePath = writeFixtureTranscript();
    const projectDir = join(testDir, projectId);
    await indexJsonlFile(db.index, filePath, projectId);

    writeFileSync(
      join(projectDir, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId,
            fullPath: filePath,
            fileMtime: Date.now(),
            firstPrompt: "First user prompt",
            messageCount: 999,
            projectPath: "/Users/craig/projects/app",
          },
        ],
      }),
    );
    await indexSessionsIndex(db.index, projectDir, projectId);

    const row = db.index
      .select({ messageCount: schema.sessions.messageCount })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    expect(row?.messageCount).toBe(EXPECTED_MESSAGE_COUNT);
  });
});
