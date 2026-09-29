import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { openTestDb, type AppDb } from "../src/lib/db/connection";
import { indexJsonlFile } from "../src/lib/db/indexer";
import {
  getSessionPrLink,
  listRecentSessionsFromDb,
  listSessionsForProjectFromDb,
} from "../src/lib/db/queries";
import { PrLinkRecordSchema } from "../src/lib/schemas";
import {
  getSessionMenuItems,
  type SessionMenuCapability,
  type SessionMenuSession,
} from "../src/lib/session-menu-items";
import { buildSessionSummaryPayloadFromDb } from "../src/lib/session-summary";

const testDir = join(tmpdir(), `claude-pr-link-test-${process.pid}`);
const projectId = "-Users-alice-projects-repository";
const sessionId = "session-alice-100";

function prLink(prNumber: number) {
  return {
    type: "pr-link",
    prUrl: `https://example.com/alice/repository/pull/${prNumber}`,
    prNumber,
    prRepository: "alice/repository",
    sessionId,
    timestamp: "2000-01-01T00:00:00.000Z",
  };
}

const userRecord = {
  type: "user",
  uuid: "u1",
  parentUuid: null,
  timestamp: "2000-01-01T00:00:00.000Z",
  sessionId,
  isSidechain: false,
  userType: "external",
  cwd: "/Users/alice/projects/repository",
  version: "2.1.71",
  message: { role: "user", content: "Open a pull request" },
};

let db: AppDb;

function writeTranscript(records: unknown[]): string {
  const filePath = join(testDir, projectId, `${sessionId}.jsonl`);
  writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return filePath;
}

beforeEach(() => {
  mkdirSync(join(testDir, projectId), { recursive: true });
  db = openTestDb();
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe("PrLinkRecordSchema", () => {
  it("parses a pr-link record", () => {
    expect(PrLinkRecordSchema.parse(prLink(100))).toStrictEqual(prLink(100));
  });

  it("rejects unknown keys", () => {
    expect(PrLinkRecordSchema.safeParse({ ...prLink(100), prTitle: "x" }).success).toBe(false);
  });
});

describe("pr-link indexing", () => {
  it("indexes the latest pr-link per session", async () => {
    const filePath = writeTranscript([userRecord, prLink(100), prLink(101)]);
    await indexJsonlFile(db.index, filePath, projectId);

    const expected = {
      number: 101,
      url: "https://example.com/alice/repository/pull/101",
      repository: "alice/repository",
    };
    expect(getSessionPrLink(db.index, sessionId)).toStrictEqual(expected);
    expect(
      listRecentSessionsFromDb(db.index, { limit: 10 }).sessions.map((session) => session.pr),
    ).toStrictEqual([expected]);
    expect(
      listSessionsForProjectFromDb(db.index, projectId).map((session) => session.pr),
    ).toStrictEqual([expected]);
    expect(buildSessionSummaryPayloadFromDb(db.index, sessionId, () => null)?.pr).toStrictEqual(
      expected,
    );
  });

  it("has no PR when the transcript has no pr-link", async () => {
    const filePath = writeTranscript([userRecord]);
    await indexJsonlFile(db.index, filePath, projectId);

    expect(getSessionPrLink(db.index, sessionId)).toBeNull();
    expect(listRecentSessionsFromDb(db.index, { limit: 10 }).sessions[0]?.pr).toBeUndefined();
  });
});

describe("Open PR in the session menu model", () => {
  const PR_URL = "https://example.com/alice/repository/pull/101";
  const capabilities = new Set<SessionMenuCapability>(["openPr", "openFinder", "pin"]);

  function menuSession(overrides: Partial<SessionMenuSession> = {}): SessionMenuSession {
    return {
      title: "Open a pull request",
      pinned: false,
      readState: "read",
      archived: false,
      prUrl: PR_URL,
      hasLivePane: false,
      forkDisabledReason: null,
      cwd: null,
      bridgeSessionId: null,
      ...overrides,
    };
  }

  it("shows Open PR with a hidden g accelerator when there is no Open in submenu", () => {
    expect(getSessionMenuItems(menuSession(), capabilities, { surface: "row" })).toEqual([
      { kind: "item", id: "open-pr", label: "Open PR", accelerator: "g", hiddenAccelerator: true },
      { kind: "separator" },
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
    ]);
  });

  it("keeps g as a hotkey-only entry when Open in takes the navigation slot", () => {
    expect(
      getSessionMenuItems(menuSession({ cwd: "/Users/alice/projects/repository" }), capabilities, {
        surface: "row",
      }),
    ).toEqual([
      {
        kind: "item",
        id: "open-in",
        label: "Open in",
        submenu: [{ kind: "item", id: "open-finder", label: "Finder", accelerator: "1" }],
      },
      { kind: "separator" },
      { kind: "item", id: "pin", label: "Pin", accelerator: "p" },
      { kind: "hotkey", id: "open-pr", accelerator: "g" },
    ]);
  });

  it("offers no Open PR entry without a PR", () => {
    expect(
      getSessionMenuItems(menuSession({ prUrl: null }), capabilities, { surface: "row" }),
    ).toEqual([{ kind: "item", id: "pin", label: "Pin", accelerator: "p" }]);
  });
});
