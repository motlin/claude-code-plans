// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

type UnreadStore = typeof import("../src/lib/unread-store");
type PersistCall =
{
	sessionId: string;
	action: "reviewed" | "unreviewed";
};

async function loadTab(calls: PersistCall[], fail = false): Promise<UnreadStore>
{
	vi.resetModules();
	const store = await import("../src/lib/unread-store");
	store.__unreadStoreTesting.setPersist(async (sessionId, action) =>
	{
		calls.push(
			{
				sessionId,
				action,
			},
		);
		if (fail) return Promise.reject(new Error("fabricated persist failure"));
		return Promise.resolve();
	});
	return store;
}

async function settle(): Promise<void>
{
	await new Promise((resolve) =>
	{
		setTimeout(resolve, 0);
	});
}

describe("unread-store", () =>
{
	let consoleWarn: ReturnType<typeof vi.spyOn>;

	beforeEach(() =>
	{
		consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() =>
	{
		consoleWarn.mockRestore();
	});

	it("caches the server's unseen flag from session summaries", async () =>
	{
		const store = await loadTab([]);
		const changes: string[] = [];
		store.subscribeUnseenWork(() => changes.push("change"));

		store.syncUnseenFromSummaries([
			{
				id: "session-test-100",
				unseen: true,
			},
			{
				id: "session-test-200",
				unseen: false,
			},
		]);
		store.syncUnseenFromSummaries([
			{
				id: "session-test-100",
				unseen: true,
			},
		]);

		expect(
			{
				first: store.hasUnseenWork("session-test-100"),
				second: store.hasUnseenWork("session-test-200"),
				unrelated: store.hasUnseenWork("session-test-300"),
				changes,
			},
		).toStrictEqual(
			{
				first: true,
				second: false,
				unrelated: false,
				changes: ["change"],
			},
		);
	});

	it("applies mark seen and mark unseen optimistically and persists them to the server", async () =>
	{
		const calls: PersistCall[] = [];
		const store = await loadTab(calls);

		store.markUnseen("session-test-100");
		const afterMarkUnseen = store.hasUnseenWork("session-test-100");
		store.markSeen("session-test-100");
		const afterMarkSeen = store.hasUnseenWork("session-test-100");
		await settle();
		// reset() puts back the real persist, so a test's stub can't swallow a later test file's server calls.
		store.__unreadStoreTesting.reset();
		store.markUnseen("session-test-100");
		await settle();

		expect(
			{
				afterMarkUnseen,
				afterMarkSeen,
				calls,
			},
		).toStrictEqual(
			{
				afterMarkUnseen: true,
				afterMarkSeen: false,
				calls: [
					{
						sessionId: "session-test-100",
						action: "unreviewed",
					},
					{
						sessionId: "session-test-100",
						action: "reviewed",
					},
				],
			},
		);
	});

	it("reverts an optimistic update the server rejected", async () =>
	{
		const calls: PersistCall[] = [];
		const store = await loadTab(calls, true);
		store.syncUnseenFromSummaries([
			{
				id: "session-test-100",
				unseen: true,
			},
		]);

		store.markSeen("session-test-100");
		const optimistic = store.hasUnseenWork("session-test-100");
		await settle();

		expect(
			{
				optimistic,
				reverted: store.hasUnseenWork("session-test-100"),
				calls,
			},
		).toStrictEqual(
			{
				optimistic: false,
				reverted: true,
				calls: [
					{
						sessionId: "session-test-100",
						action: "reviewed",
					},
				],
			},
		);
	});

	it("marks every unseen session seen on the server for clearAll", async () =>
	{
		const calls: PersistCall[] = [];
		const store = await loadTab(calls);
		store.syncUnseenFromSummaries([
			{
				id: "session-test-100",
				unseen: true,
			},
			{
				id: "session-test-200",
				unseen: false,
			},
			{
				id: "session-test-300",
				unseen: true,
			},
		]);

		store.clearAll();
		await settle();

		expect(
			{
				first: store.hasUnseenWork("session-test-100"),
				third: store.hasUnseenWork("session-test-300"),
				calls,
			},
		).toStrictEqual(
			{
				first: false,
				third: false,
				calls: [
					{
						sessionId: "session-test-100",
						action: "reviewed",
					},
					{
						sessionId: "session-test-300",
						action: "reviewed",
					},
				],
			},
		);
	});

	it("keeps two tabs in agreement once the server's SSE summary reaches both", async () =>
	{
		const calls: PersistCall[] = [];
		const tabA = await loadTab(calls);
		const tabB = await loadTab(calls);
		const broadcast = (unseen: boolean) =>
		{
			const summaries = [
				{
					id: "session-test-100",
					unseen,
				},
			];
			tabA.syncUnseenFromSummaries(summaries);
			tabB.syncUnseenFromSummaries(summaries);
		};
		const observe = () => (
		{
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

		expect(
			{
				beforeBroadcast,
				afterUnseenBroadcast,
				afterSeenBroadcast,
				calls,
			},
		).toStrictEqual(
			{
				beforeBroadcast:
				{
					tabA: true,
					tabB: false,
				},
				afterUnseenBroadcast:
				{
					tabA: true,
					tabB: true,
				},
				afterSeenBroadcast:
				{
					tabA: false,
					tabB: false,
				},
				calls: [
					{
						sessionId: "session-test-100",
						action: "unreviewed",
					},
					{
						sessionId: "session-test-100",
						action: "reviewed",
					},
				],
			},
		);
	});
});

describe("unread-store explicit unreads (upstream explicitUnreadIds)", () =>
{
	const KEY = "ccb-explicit-unread-v1";

	afterEach(() =>
	{
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("records only a hand mark as explicit and clears it on every path that reads the session", async () =>
	{
		const store = await loadTab([]);
		const marks = () => (
		{
			explicit: store.isExplicitUnread("s1"),
			unseen: store.hasUnseenWork("s1"),
		});

		store.markUnseen("s1");
		const plain = marks();
		store.markSeen("s1");
		store.syncUnseenFromSummaries([
			{
				id: "s1",
				unseen: true,
			},
		]);
		const synced = marks();
		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		const explicit = marks();
		const stored = localStorage.getItem(KEY);
		store.markSeen("s1");
		const afterMarkSeen = marks();
		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		store.syncUnseenFromSummaries([
			{
				id: "s1",
				unseen: false,
			},
		]);
		const afterServerSeen = marks();
		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		store.clearAll();
		const afterClearAll = marks();
		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		store.toggleUnseen("s1");
		const afterToggleSeen = marks();
		store.toggleUnseen("s1");
		const afterToggleUnseen = marks();
		await settle();

		expect(
			{
				plain,
				synced,
				explicit,
				stored,
				afterMarkSeen,
				afterServerSeen,
				afterClearAll,
				afterToggleSeen,
				afterToggleUnseen,
				storedAfter: localStorage.getItem(KEY),
			},
		).toStrictEqual(
			{
				plain:
				{
					explicit: false,
					unseen: true,
				},
				synced:
				{
					explicit: false,
					unseen: true,
				},
				explicit:
				{
					explicit: true,
					unseen: true,
				},
				stored: JSON.stringify(
					{
						state:
						{
							explicitUnreadIds: ["s1"],
						},
						version: 0,
					},
				),
				afterMarkSeen:
				{
					explicit: false,
					unseen: false,
				},
				afterServerSeen:
				{
					explicit: false,
					unseen: false,
				},
				afterClearAll:
				{
					explicit: false,
					unseen: false,
				},
				afterToggleSeen:
				{
					explicit: false,
					unseen: false,
				},
				afterToggleUnseen:
				{
					explicit: true,
					unseen: true,
				},
				storedAfter: JSON.stringify(
					{
						state:
						{
							explicitUnreadIds: ["s1"],
						},
						version: 0,
					},
				),
			},
		);
	});

	it("survives a reload and loads malformed storage as empty", async () =>
	{
		const first = await loadTab([]);
		first.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		const reloaded = await loadTab([]);
		const afterReload = [...reloaded.explicitUnreadIds()];
		localStorage.setItem(KEY, "{not json");
		const malformed = await loadTab([]);
		const afterMalformed = [...malformed.explicitUnreadIds()];
		localStorage.setItem(
			KEY,
			JSON.stringify(
				{
					state:
					{
						explicitUnreadIds: [7],
					},
					version: 0,
				},
			),
		);
		const wrongShape = await loadTab([]);
		await settle();

		expect(
			{
				afterReload,
				afterMalformed,
				afterWrongShape: [...wrongShape.explicitUnreadIds()],
			},
		).toStrictEqual(
			{
				afterReload: ["s1"],
				afterMalformed: [],
				afterWrongShape: [],
			},
		);
	});

	it("keeps working in memory when storage throws", async () =>
	{
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() =>
		{
			throw new Error("fabricated storage failure");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("fabricated storage failure");
		});
		const store = await loadTab([]);

		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		await settle();

		expect(store.isExplicitUnread("s1")).toBe(true);
	});

	it("rolls back the explicit bit with the unseen flag when the server rejects", async () =>
	{
		const store = await loadTab([], true);
		const changes: number[] = [];
		store.subscribeUnseenWork(() => changes.push(store.unseenWorkVersion()));
		vi.spyOn(console, "warn").mockImplementation(() => {});

		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		const optimistic = store.isExplicitUnread("s1");
		await settle();

		expect(
			{
				optimistic,
				explicit: store.isExplicitUnread("s1"),
				unseen: store.hasUnseenWork("s1"),
				changes: changes.length,
				stored: localStorage.getItem(KEY),
			},
		).toStrictEqual(
			{
				optimistic: true,
				explicit: false,
				unseen: false,
				changes: 2,
				stored: JSON.stringify(
					{
						state:
						{
							explicitUnreadIds: [],
						},
						version: 0,
					},
				),
			},
		);
	});

	it("notifies when only the explicit bit changes", async () =>
	{
		const store = await loadTab([]);
		store.syncUnseenFromSummaries([
			{
				id: "s1",
				unseen: true,
			},
		]);
		let changes = 0;
		store.subscribeUnseenWork(() =>
		{
			changes++;
		});

		store.markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		await settle();

		expect(changes).toBe(1);
	});
});
