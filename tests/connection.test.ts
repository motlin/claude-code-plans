import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openAppDb } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

describe("openAppDb", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws under vitest when called without an explicit cacheDir", () => {
    expect(() => openAppDb()).toThrow(/must pass an explicit cacheDir/);
  });

  it("opens the databases when given an explicit cacheDir", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
    tempDirs.push(cacheDir);
    const db = openAppDb({ cacheDir });
    db.close();
  });

  it("preserves durable user data while rebuilding derived tables", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "open-app-db-test-"));
    tempDirs.push(cacheDir);
    const original = openAppDb({ cacheDir });
    original.index
      .insert(schema.projects)
      .values({
        id: "project-test-100",
        name: "Alice fixture project",
        updatedAt: 1_000,
      })
      .run();
    original.index
      .insert(schema.starredSessions)
      .values({ sessionId: "session-test-100", starredAt: 1_000 })
      .run();
    original.index
      .insert(schema.sessionViewStates)
      .values({
        sessionId: "session-test-100",
        lastViewedMessageIndex: 10,
        reviewTargetMessageIndex: 20,
        updatedAt: 2_000,
      })
      .run();
    original.index
      .insert(schema.herdrTerminalViewStates)
      .values({
        terminalId: "terminal-test-100",
        sessionId: "session-test-100",
        viewed: 1,
        updatedAt: 3_000,
      })
      .run();
    original.index
      .insert(schema.reviews)
      .values({
        reviewId: "review-test-100",
        bundle: {
          reviewId: "review-test-100",
          sessionId: "session-test-100",
          cwd: "/fixture/alice-repository",
          diff: "diff --git a/alice.txt b/alice.txt",
          summary: null,
          findings: [],
          generatedAt: "2000-01-01T00:00:00.000Z",
        },
      })
      .run();
    original.index
      .insert(schema.hookSchemaDrift)
      .values({
        hookEventName: "TestEvent",
        bodySha256: "sha256-test-100",
        rawBody: "{}",
        issuesJson: "[]",
        count: 1,
        firstSeenAt: 4_000,
        lastSeenAt: 5_000,
      })
      .run();
    original.index
      .update(schema.metadata)
      .set({ value: "19" })
      .where(eq(schema.metadata.key, "schema_version"))
      .run();
    original.close();

    const reopened = openAppDb({ cacheDir });
    const state = {
      projects: reopened.index.select().from(schema.projects).all(),
      starredSessions: reopened.index.select().from(schema.starredSessions).all(),
      sessionViewStates: reopened.index.select().from(schema.sessionViewStates).all(),
      terminalViewStates: reopened.index.select().from(schema.herdrTerminalViewStates).all(),
      reviews: reopened.index.select().from(schema.reviews).all(),
      hookSchemaDrift: reopened.index.select().from(schema.hookSchemaDrift).all(),
      version: reopened.index
        .select({ value: schema.metadata.value })
        .from(schema.metadata)
        .where(eq(schema.metadata.key, "schema_version"))
        .get(),
    };
    reopened.close();

    expect(state).toStrictEqual({
      projects: [],
      starredSessions: [{ sessionId: "session-test-100", starredAt: 1_000 }],
      sessionViewStates: [
        {
          sessionId: "session-test-100",
          lastViewedMessageIndex: 10,
          reviewTargetMessageIndex: 20,
          updatedAt: 2_000,
        },
      ],
      terminalViewStates: [
        {
          terminalId: "terminal-test-100",
          sessionId: "session-test-100",
          viewed: 1,
          updatedAt: 3_000,
        },
      ],
      reviews: [
        {
          reviewId: "review-test-100",
          bundle: {
            reviewId: "review-test-100",
            sessionId: "session-test-100",
            cwd: "/fixture/alice-repository",
            diff: "diff --git a/alice.txt b/alice.txt",
            summary: null,
            findings: [],
            generatedAt: "2000-01-01T00:00:00.000Z",
          },
        },
      ],
      hookSchemaDrift: [
        {
          hookEventName: "TestEvent",
          bodySha256: "sha256-test-100",
          rawBody: "{}",
          issuesJson: "[]",
          count: 1,
          firstSeenAt: 4_000,
          lastSeenAt: 5_000,
        },
      ],
      version: { value: schema.SCHEMA_VERSION },
    });
  });
});
