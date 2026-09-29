import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexJsonlFile } from "../src/lib/db/indexer";
import { listRecentSessionsFromDb } from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import { ForkedFromSchema } from "../src/lib/schemas";
import { buildSessionSummaryPayloadFromDb } from "../src/lib/session-summary";

const testDir = join(tmpdir(), `claude-fork-lineage-test-${process.pid}`);
const projectId = "-Users-alice-projects-repository";
const sessionId = "session-alice-fork";

function userRecord(uuid: string, extra: Record<string, unknown> = {}) {
  return {
    type: "user",
    uuid,
    parentUuid: null,
    timestamp: "2000-01-01T00:00:00.000Z",
    sessionId,
    isSidechain: false,
    userType: "external",
    cwd: "/Users/alice/projects/repository",
    version: "2.1.284",
    message: { role: "user", content: "Keep going on the branch" },
    ...extra,
  };
}

let db: AppDb;

function writeTranscript(records: unknown[]): string {
  const filePath = join(testDir, projectId, `${sessionId}.jsonl`);
  writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return filePath;
}

function lineageRow() {
  return db.index
    .select({
      id: schema.sessions.id,
      projectId: schema.sessions.projectId,
      forkedFromSessionId: schema.sessions.forkedFromSessionId,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
}

beforeEach(() => {
  mkdirSync(join(testDir, projectId), { recursive: true });
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("ForkedFromSchema", () => {
  it("accepts the string form", () => {
    expect(ForkedFromSchema.parse("parent-1")).toStrictEqual("parent-1");
  });

  it("accepts the object form the CLI writes", () => {
    const value = { sessionId: "parent-1", messageUuid: "m1" };
    expect(ForkedFromSchema.parse(value)).toStrictEqual(value);
  });

  it("rejects unknown keys in the object form", () => {
    expect(ForkedFromSchema.safeParse({ sessionId: "parent-1", extra: 1 }).success).toBe(false);
  });
});

describe("fork lineage indexing", () => {
  it("indexes the string form", async () => {
    await indexJsonlFile(
      db.index,
      writeTranscript([userRecord("u1", { forkedFrom: "parent-string" })]),
      projectId,
    );
    expect(lineageRow()).toStrictEqual({
      id: sessionId,
      projectId,
      forkedFromSessionId: "parent-string",
    });
  });

  it("indexes the first object-form record", async () => {
    await indexJsonlFile(
      db.index,
      writeTranscript([
        userRecord("u1", { forkedFrom: { sessionId: "parent-object", messageUuid: "p1" } }),
        userRecord("u2", { forkedFrom: { sessionId: "parent-later", messageUuid: "p2" } }),
      ]),
      projectId,
    );
    expect(lineageRow()).toStrictEqual({
      id: sessionId,
      projectId,
      forkedFromSessionId: "parent-object",
    });
    expect(
      listRecentSessionsFromDb(db.index, { limit: 10 }).sessions.map(
        (session) => session.forkedFromSessionId,
      ),
    ).toStrictEqual(["parent-object"]);
    expect(
      buildSessionSummaryPayloadFromDb(db.index, sessionId, () => null)?.forkedFromSessionId,
    ).toStrictEqual("parent-object");
  });

  it("stores null when no record carries forkedFrom", async () => {
    await indexJsonlFile(db.index, writeTranscript([userRecord("u1")]), projectId);
    expect(lineageRow()).toStrictEqual({ id: sessionId, projectId, forkedFromSessionId: null });
    expect(
      listRecentSessionsFromDb(db.index, { limit: 10 }).sessions[0]?.forkedFromSessionId,
    ).toBeUndefined();
    expect(
      buildSessionSummaryPayloadFromDb(db.index, sessionId, () => null)?.forkedFromSessionId,
    ).toBeUndefined();
  });
});
