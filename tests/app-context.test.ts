import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAppContext, disposeAppContext } from "../src/lib/app-context";
import type { AppContextConfig } from "../src/lib/app-context";
import { sweepSessions } from "../src/lib/active-session-store";
import type { ActiveSessionEntry } from "../src/lib/active-session-store";

const testDir = join(tmpdir(), "claude-app-context-test-" + process.pid);

function makeTestConfig(): AppContextConfig {
  return {
    projectsDir: join(testDir, "projects"),
    plansDir: join(testDir, "plans"),
    commandsDir: join(testDir, "commands"),
    pluginsDir: join(testDir, "plugins"),
    tasksDir: join(testDir, "tasks"),
    statuslineDir: join(testDir, "statusline"),
    cacheDir: join(testDir, "cache"),
  };
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  for (const sub of ["projects", "plans", "commands", "plugins", "tasks", "statusline", "cache"]) {
    mkdirSync(join(testDir, sub), { recursive: true });
  }
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("AppContext", () => {
  it("creates and disposes without leaking handles", async () => {
    const ctx = await createAppContext(makeTestConfig());

    expect(typeof ctx.db).toBe("object");
    expect(typeof ctx.watcher).toBe("object");
    expect(ctx.sseClients).toStrictEqual(new Set());
    expect(ctx.sessionStore).toStrictEqual(new Map());
    expect(typeof ctx.sweepTimer).toBe("object");

    await disposeAppContext(ctx);
  });

  it("dispose closes SSE clients", async () => {
    const ctx = await createAppContext(makeTestConfig());

    const closed: boolean[] = [];
    const fakeClient = {
      close: () => {
        closed.push(true);
      },
      enqueue: () => {},
    } as unknown as ReadableStreamDefaultController;

    ctx.sseClients.add(fakeClient);
    expect(ctx.sseClients.size).toBe(1);

    await disposeAppContext(ctx);

    expect(closed).toStrictEqual([true]);
    expect(ctx.sseClients.size).toBe(0);
  });
});

describe("sweepSessions", () => {
  it("removes stale sessions and keeps fresh ones", () => {
    const store = new Map<string, ActiveSessionEntry>();

    store.set("stale", {
      sessionId: "stale",
      cwd: "/tmp",
      model: "test",
      startedAt: Date.now() - 20 * 60 * 1000,
      lastActivity: Date.now() - 20 * 60 * 1000,
      claudeEnv: {},
    });

    store.set("fresh", {
      sessionId: "fresh",
      cwd: "/tmp",
      model: "test",
      startedAt: Date.now(),
      lastActivity: Date.now(),
      claudeEnv: {},
    });

    sweepSessions(store);

    expect(store.size).toBe(1);
    expect(store.has("stale")).toBe(false);
    expect(store.has("fresh")).toBe(true);
  });
});
