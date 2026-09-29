import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openAppDb, openTestDb } from "../src/lib/db/connection";
import { dismissHomeSession, getHomeDismissals } from "../src/lib/db/home-dismissals";

const ALICE = "session-alice-100";
const BOB = "session-bob-200";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("home dismissals", () => {
  it("records the latest dismissal time per session", () => {
    const db = openTestDb();
    dismissHomeSession(db.index, ALICE, 1_000);
    dismissHomeSession(db.index, BOB, 2_000);
    dismissHomeSession(db.index, ALICE, 3_000);
    const dismissals = getHomeDismissals(db.index);
    db.close();

    expect(dismissals).toStrictEqual({ [ALICE]: 3_000, [BOB]: 2_000 });
  });

  it("persists across a reopen at the same schema version", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "home-dismissals-test-"));
    tempDirs.push(cacheDir);
    const original = openAppDb({ cacheDir });
    dismissHomeSession(original.index, ALICE, 5_000);
    original.close();

    const reopened = openAppDb({ cacheDir });
    const dismissals = getHomeDismissals(reopened.index);
    reopened.close();

    expect(dismissals).toStrictEqual({ [ALICE]: 5_000 });
  });
});

describe("GET/POST /api/home/dismissals", () => {
  type ApiHandler = (context: { request: Request }) => Response | Promise<Response>;

  afterEach(() => {
    vi.doUnmock("../src/lib/db");
    vi.resetModules();
  });

  it("records a dismissal, lists every dismissal, and rejects bad or cross-site bodies", async () => {
    const db = openTestDb();
    vi.doMock("../src/lib/db", () => ({ getDb: () => db }));
    const { Route } = await import("../src/routes/api/home.dismissals");
    const handlers = (
      Route as unknown as { options: { server: { handlers: Record<string, ApiHandler> } } }
    ).options.server.handlers;
    const url = "http://localhost/api/home/dismissals";
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      handlers["POST"]!({
        request: new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      });

    const created = await post({ sessionId: ALICE });
    const invalid = await post({ sessionId: ALICE, extra: true });
    const crossSite = await post({ sessionId: BOB }, { "Sec-Fetch-Site": "cross-site" });
    const listed = await handlers["GET"]!({ request: new Request(url) });
    const dismissals = getHomeDismissals(db.index);
    db.close();

    expect({
      created: {
        status: created.status,
        sessionIds: Object.keys((await created.json()).dismissals),
      },
      invalid: invalid.status,
      crossSite: crossSite.status,
      listed: await listed.json(),
    }).toStrictEqual({
      created: { status: 200, sessionIds: [ALICE] },
      invalid: 400,
      crossSite: 403,
      listed: { dismissals },
    });
  });
});
