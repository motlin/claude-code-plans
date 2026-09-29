import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type UnreadStore = typeof import("../src/lib/unread-store");
type PersistCall = { sessionId: string; action: "reviewed" | "unreviewed" };

async function loadTab(calls: PersistCall[], fail = false): Promise<UnreadStore> {
  vi.resetModules();
  const store = await import("../src/lib/unread-store");
  store.__unreadStoreTesting.setPersist(async (sessionId, action) => {
    calls.push({ sessionId, action });
    if (fail) throw new Error("fabricated persist failure");
  });
  return store;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("unread-store", () => {
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("caches the server's unseen flag from session summaries", async () => {
    const store = await loadTab([]);
    const changes: string[] = [];
    store.subscribeUnseenWork(() => changes.push("change"));

    store.syncUnseenFromSummaries([
      { id: "session-test-100", unseen: true },
      { id: "session-test-200", unseen: false },
    ]);
    store.syncUnseenFromSummaries([{ id: "session-test-100", unseen: true }]);

    expect({
      first: store.hasUnseenWork("session-test-100"),
      second: store.hasUnseenWork("session-test-200"),
      unrelated: store.hasUnseenWork("session-test-300"),
      changes,
    }).toStrictEqual({ first: true, second: false, unrelated: false, changes: ["change"] });
  });

  it("applies mark seen and mark unseen optimistically and persists them to the server", async () => {
    const calls: PersistCall[] = [];
    const store = await loadTab(calls);

    store.markUnseen("session-test-100");
    const afterMarkUnseen = store.hasUnseenWork("session-test-100");
    store.markSeen("session-test-100");
    const afterMarkSeen = store.hasUnseenWork("session-test-100");
    await settle();

    expect({ afterMarkUnseen, afterMarkSeen, calls }).toStrictEqual({
      afterMarkUnseen: true,
      afterMarkSeen: false,
      calls: [
        { sessionId: "session-test-100", action: "unreviewed" },
        { sessionId: "session-test-100", action: "reviewed" },
      ],
    });
  });

  it("reverts an optimistic update the server rejected", async () => {
    const calls: PersistCall[] = [];
    const store = await loadTab(calls, true);
    store.syncUnseenFromSummaries([{ id: "session-test-100", unseen: true }]);

    store.markSeen("session-test-100");
    const optimistic = store.hasUnseenWork("session-test-100");
    await settle();

    expect({ optimistic, reverted: store.hasUnseenWork("session-test-100"), calls }).toStrictEqual({
      optimistic: false,
      reverted: true,
      calls: [{ sessionId: "session-test-100", action: "reviewed" }],
    });
  });

  it("marks every unseen session seen on the server for clearAll", async () => {
    const calls: PersistCall[] = [];
    const store = await loadTab(calls);
    store.syncUnseenFromSummaries([
      { id: "session-test-100", unseen: true },
      { id: "session-test-200", unseen: false },
      { id: "session-test-300", unseen: true },
    ]);

    store.clearAll();
    await settle();

    expect({
      first: store.hasUnseenWork("session-test-100"),
      third: store.hasUnseenWork("session-test-300"),
      calls,
    }).toStrictEqual({
      first: false,
      third: false,
      calls: [
        { sessionId: "session-test-100", action: "reviewed" },
        { sessionId: "session-test-300", action: "reviewed" },
      ],
    });
  });

  it("keeps two tabs in agreement once the server's SSE summary reaches both", async () => {
    const calls: PersistCall[] = [];
    const tabA = await loadTab(calls);
    const tabB = await loadTab(calls);
    const broadcast = (unseen: boolean) => {
      const summaries = [{ id: "session-test-100", unseen }];
      tabA.syncUnseenFromSummaries(summaries);
      tabB.syncUnseenFromSummaries(summaries);
    };
    const observe = () => ({
      tabA: tabA.hasUnseenWork("session-test-100"),
      tabB: tabB.hasUnseenWork("session-test-100"),
    });

    tabA.markUnseen("session-test-100");
    const beforeBroadcast = observe();
    broadcast(true);
    const afterUnseenBroadcast = observe();
    tabB.markSeen("session-test-100");
    broadcast(false);
    const afterSeenBroadcast = observe();
    await settle();

    expect({ beforeBroadcast, afterUnseenBroadcast, afterSeenBroadcast, calls }).toStrictEqual({
      beforeBroadcast: { tabA: true, tabB: false },
      afterUnseenBroadcast: { tabA: true, tabB: true },
      afterSeenBroadcast: { tabA: false, tabB: false },
      calls: [
        { sessionId: "session-test-100", action: "unreviewed" },
        { sessionId: "session-test-100", action: "reviewed" },
      ],
    });
  });
});
