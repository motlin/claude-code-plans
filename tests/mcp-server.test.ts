import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openCorpusDatabase, type CorpusDatabase } from "../mcp-server/database";
import {
  getPrompt,
  getSession,
  listProjects,
  listSessions,
  listSubagents,
  readConversation,
  search,
  type ToolContext,
} from "../mcp-server/tools";
import { openAppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

const NOW_MS = Date.parse("2000-01-08T00:10:00.000Z");
const INDEXED_AT_MS = Date.parse("2000-01-08T00:00:00.000Z");
const STALE_INDEX = {
  updated: "2000-01-08T00:00:00.000Z",
  stale: true,
  note: "The ccp index may be stale. Start ccp to refresh it; this MCP server never indexes.",
};

let fixtureDir: string;
let database: CorpusDatabase;
let context: ToolContext;
let indexPath: string;

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function jsonl(...records: Record<string, unknown>[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

beforeEach(() => {
  fixtureDir = mkdtempSync(join(process.cwd(), ".llm/mcp-server-test-"));
  const transcriptDir = join(fixtureDir, "fixtures");
  mkdirSync(transcriptDir);
  const aliceTranscript = join(transcriptDir, "alice-session.jsonl");
  const bobTranscript = join(transcriptDir, "bob-session.jsonl");
  const subagentTranscript = join(transcriptDir, "alice-subagent.jsonl");
  writeFileSync(
    aliceTranscript,
    jsonl(
      {
        type: "user",
        sessionId: "session-alice",
        timestamp: "2000-01-01T00:00:00.000Z",
        parentUuid: null,
        message: { role: "user", content: "Trace the ingest pipeline" },
      },
      {
        type: "assistant",
        sessionId: "session-alice",
        timestamp: "2000-01-01T00:01:00.000Z",
        optional: null,
        message: { role: "assistant", content: [{ type: "text", text: "The queue was stale." }] },
      },
      {
        type: "user",
        sessionId: "session-alice",
        timestamp: "2000-01-01T00:02:00.000Z",
        message: { role: "user", content: "Done" },
      },
    ),
  );
  writeFileSync(
    bobTranscript,
    jsonl({
      type: "user",
      sessionId: "session-bob",
      timestamp: "1999-12-31T00:00:00.000Z",
      message: { role: "user", content: "Review tests" },
    }),
  );
  writeFileSync(subagentTranscript, jsonl({ type: "system", sessionId: "agent-alice" }));

  const writable = openAppDb({ cacheDir: fixtureDir });
  writable.index
    .insert(schema.projects)
    .values([
      {
        id: "project-alice",
        name: "Alice Project",
        projectPath: "/example/alice",
        updatedAt: Date.parse("2000-01-01T00:00:00.000Z"),
      },
      {
        id: "project-bob",
        name: "Bob Project",
        projectPath: null,
        updatedAt: Date.parse("1999-12-31T00:00:00.000Z"),
      },
    ])
    .run();
  writable.index
    .insert(schema.sessions)
    .values([
      {
        id: "session-alice",
        projectId: "project-alice",
        title: "Ingest pipeline conclusion",
        firstPrompt: "Trace ingest",
        summary: "The queue was stale",
        customTitle: null,
        messageCount: 3,
        gitBranch: "main",
        cwd: "/example/alice",
        isSidechain: 0,
        createdAt: Date.parse("2000-01-01T00:00:00.000Z"),
        mtimeMs: Date.parse("2000-01-08T00:00:00.000Z"),
        filePath: aliceTranscript,
      },
      {
        id: "session-bob",
        projectId: "project-bob",
        title: "Test review",
        firstPrompt: null,
        summary: null,
        customTitle: null,
        messageCount: 1,
        gitBranch: null,
        cwd: null,
        isSidechain: 0,
        createdAt: Date.parse("1999-12-31T00:00:00.000Z"),
        mtimeMs: Date.parse("2000-01-07T00:00:00.000Z"),
        filePath: bobTranscript,
      },
    ])
    .run();
  writable.index
    .insert(schema.subagents)
    .values({
      id: "agent-alice",
      sessionId: "session-alice",
      projectId: "project-alice",
      parentAgentId: null,
      agentType: "Explore",
      slug: null,
      description: "Inspect the queue",
      startedAt: "2000-01-01T00:00:30Z",
      finishedAt: null,
      filePath: subagentTranscript,
      mtimeMs: Date.parse("2000-01-01T00:00:30.000Z"),
    })
    .run();
  writable.index
    .insert(schema.indexedFiles)
    .values({
      path: aliceTranscript,
      mtimeMs: Date.parse("2000-01-08T00:00:00.000Z"),
      sizeBytes: readFileSync(aliceTranscript).byteLength,
      indexedAt: INDEXED_AT_MS,
    })
    .run();
  writable.index.run(
    sql`INSERT INTO message_content_fts(session_id, content)
        VALUES ('session-alice', 'The ingest pipeline concluded that the queue was stale')`,
  );
  writable.close();

  indexPath = join(fixtureDir, "index.db");
  database = openCorpusDatabase(fixtureDir);
  context = {
    db: database.index,
    now: () => NOW_MS,
    pendingApprovals: () => [
      {
        sessionId: "session-alice",
        projectId: "project-alice",
        projectName: "Alice Project",
        toolName: "AskUserQuestion",
        toolUseId: "tool-alice",
        blockedSince: "2000-01-01T00:03:00Z",
        planFilename: null,
        questionPreview: "Continue with the queue repair?",
      },
    ],
  };
});

afterEach(() => {
  database.close();
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("read-only MCP corpus tools", () => {
  it("lists and pages sessions with compact ISO-shaped fields", () => {
    expect(listSessions(context, { limit: 1 })).toStrictEqual({
      sessions: [
        {
          id: "session-alice",
          title: "Ingest pipeline conclusion",
          project: "Alice Project",
          updated: "2000-01-08T00:00:00.000Z",
          created: "2000-01-01T00:00:00.000Z",
          messages: 3,
          summary: "The queue was stale",
          branch: "main",
          cwd: "/example/alice",
        },
      ],
      hasMore: true,
      cursor: { updated: "2000-01-08T00:00:00.000Z", id: "session-alice" },
      index: STALE_INDEX,
    });
  });

  it("returns an explicit range from the structured transcript and omits null fields", () => {
    expect(readConversation(context, { id: "session-alice", offset: 1, limit: 1 })).toStrictEqual({
      id: "session-alice",
      offset: 1,
      total: 3,
      records: [
        {
          type: "assistant",
          sessionId: "session-alice",
          timestamp: "2000-01-01T00:01:00.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "The queue was stale." }],
          },
        },
      ],
      hasMore: true,
      index: STALE_INDEX,
    });
  });

  it("searches both session metadata and indexed message content", () => {
    expect(search(context, { query: "ingest", limit: 1 })).toStrictEqual({
      sessions: [
        {
          id: "session-alice",
          title: "Ingest pipeline conclusion",
          project: "Alice Project",
          updated: "2000-01-08T00:00:00.000Z",
          messages: 3,
          snippet: "Trace <mark>ingest</mark>",
          summary: "The queue was stale",
        },
      ],
      messages: [
        {
          id: "session-alice",
          title: "Ingest pipeline conclusion",
          project: "Alice Project",
          updated: "2000-01-08T00:00:00.000Z",
          messages: 3,
          snippet: "The <mark>ingest</mark> pipeline concluded that the queue was stale",
        },
      ],
      hasMore: false,
      index: STALE_INDEX,
    });
  });

  it("returns pending prompts without null-valued optional fields", () => {
    expect(getPrompt(context, { sessionId: "session-alice", limit: 1 })).toStrictEqual({
      prompts: [
        {
          id: "tool-alice",
          session: "session-alice",
          project: "Alice Project",
          tool: "AskUserQuestion",
          blocked: "2000-01-01T00:03:00.000Z",
          question: "Continue with the queue repair?",
        },
      ],
      hasMore: false,
      index: STALE_INDEX,
    });
  });

  it("gets one session through the existing metadata query", () => {
    expect(getSession(context, { id: "session-alice" })).toStrictEqual({
      session: {
        id: "session-alice",
        messages: 3,
        project: "Alice Project",
        branch: "main",
        cwd: "/example/alice",
      },
      found: true,
      index: STALE_INDEX,
    });
  });

  it("lists subagents with ISO timestamps and omitted null fields", () => {
    expect(listSubagents(context, { id: "session-alice", limit: 1 })).toStrictEqual({
      subagents: [
        {
          id: "agent-alice",
          session: "session-alice",
          project: "project-alice",
          updated: "2000-01-01T00:00:30.000Z",
          type: "Explore",
          description: "Inspect the queue",
          started: "2000-01-01T00:00:30.000Z",
        },
      ],
      hasMore: false,
      index: STALE_INDEX,
    });
  });

  it("lists projects with a hard cap and hasMore flag", () => {
    expect(listProjects(context, { limit: 1 })).toStrictEqual({
      projects: [
        {
          id: "project-alice",
          name: "Alice Project",
          sessions: 1,
          updated: "2000-01-08T00:00:00.000Z",
          path: "/example/alice",
        },
      ],
      hasMore: true,
      index: STALE_INDEX,
    });
  });

  it("does not mutate database state while every handler runs", () => {
    const before = {
      hash: fileHash(indexPath),
      readonly: database.sqlite.readonly,
      changes: database.sqlite.prepare("SELECT total_changes() AS changes").get(),
    };

    listSessions(context, { limit: 2 });
    readConversation(context, { id: "session-alice", offset: 0, limit: 3 });
    search(context, { query: "ingest", limit: 2 });
    getPrompt(context, { limit: 2 });
    getSession(context, { id: "session-alice" });
    listSubagents(context, { id: "session-alice", limit: 2 });
    listProjects(context, { limit: 2 });

    const after = {
      hash: fileHash(indexPath),
      readonly: database.sqlite.readonly,
      changes: database.sqlite.prepare("SELECT total_changes() AS changes").get(),
    };
    expect({ before, after }).toStrictEqual({
      before: { hash: before.hash, readonly: true, changes: { changes: 0 } },
      after: { hash: before.hash, readonly: true, changes: { changes: 0 } },
    });
  });
});
