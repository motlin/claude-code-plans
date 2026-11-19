// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	cancelPendingRecentsRowCount,
	DEFAULT_SIDEBAR_STATE,
	readSidebarState,
	recordRecentsRowCount,
	rememberedRecentsRows,
	setFamiliesCollapsed,
	showAllNestedSessions,
	SIDEBAR_STORAGE_KEY,
	toggleFamilyCollapsed,
	toggleSidebarCollapsed,
	writeSidebarState,
} from "../src/lib/sidebar-store";
import {installLocalStorage} from "./fake-storage";

describe("sidebar-store", () =>
{
	let storage: ReturnType<typeof installLocalStorage>;

	beforeEach(() =>
	{
		storage = installLocalStorage();
	});

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("defaults to expanded at the upstream width with no collapsed groups", () =>
	{
		expect(readSidebarState()).toStrictEqual(
			{
				collapsed: false,
				width: 288,
				collapsedGroups: [],
				collapsedFamilies: [],
			},
		);
		expect(DEFAULT_SIDEBAR_STATE).toStrictEqual(
			{
				collapsed: false,
				width: 288,
				collapsedGroups: [],
				collapsedFamilies: [],
			},
		);
	});

	it("persists a toggle to localStorage and reads it back", () =>
	{
		toggleSidebarCollapsed();

		expect(readSidebarState()).toStrictEqual(
			{
				collapsed: true,
				width: 288,
				collapsedGroups: [],
				collapsedFamilies: [],
			},
		);
		expect(JSON.parse(storage.getItem(SIDEBAR_STORAGE_KEY) ?? "null")).toStrictEqual(
			{
				collapsed: true,
				width: 288,
				collapsedGroups: [],
				collapsedFamilies: [],
			},
		);

		toggleSidebarCollapsed();
		expect(readSidebarState()).toStrictEqual(
			{
				collapsed: false,
				width: 288,
				collapsedGroups: [],
				collapsedFamilies: [],
			},
		);
	});

	it("round-trips width and collapsed groups", () =>
	{
		writeSidebarState(
			{
				collapsed: true,
				width: 320,
				collapsedGroups: ["Today", "Older"],
				collapsedFamilies: ["code:a"],
			},
		);

		expect(readSidebarState()).toStrictEqual(
			{
				collapsed: true,
				width: 320,
				collapsedGroups: ["Today", "Older"],
				collapsedFamilies: ["code:a"],
			},
		);
	});

	it("reads state saved before collapsedFamilies existed with no collapsed families", () =>
	{
		storage.setItem(
			SIDEBAR_STORAGE_KEY,
			JSON.stringify(
				{
					collapsed: true,
					width: 300,
					collapsedGroups: ["pinned"],
				},
			),
		);

		expect(readSidebarState()).toStrictEqual(
			{
				collapsed: true,
				width: 300,
				collapsedGroups: ["pinned"],
				collapsedFamilies: [],
			},
		);
	});

	it("toggles one family and sets many families collapsed at once", () =>
	{
		toggleFamilyCollapsed("a");
		toggleFamilyCollapsed("b");
		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:a", "code:b"]);

		toggleFamilyCollapsed("a");
		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:b"]);

		setFamiliesCollapsed(["a", "b", "c"], true);
		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:b", "code:a", "code:c"]);

		setFamiliesCollapsed(["a", "c"], false);
		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:b"]);
	});

	// Upstream `wI(false)` expands the whole current list, so keys for heads no longer listed go too.
	it("shows all nested sessions by clearing every family key, stale ones included", () =>
	{
		writeSidebarState(
			{
				collapsed: true,
				width: 300,
				collapsedGroups: ["state-done"],
				collapsedFamilies: ["code:gone", "code:h1"],
			},
		);
		setFamiliesCollapsed(["h1", "h2"], true);
		expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:gone", "code:h1", "code:h2"]);

		showAllNestedSessions();
		expect(readSidebarState()).toStrictEqual(
			{
				collapsed: true,
				width: 300,
				collapsedGroups: ["state-done"],
				collapsedFamilies: [],
			},
		);
	});

	it("falls back to defaults on corrupt JSON", () =>
	{
		storage.setItem(SIDEBAR_STORAGE_KEY, "{not json");

		expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);
	});

	it("falls back to defaults when the stored shape fails the strict schema", () =>
	{
		storage.setItem(
			SIDEBAR_STORAGE_KEY,
			JSON.stringify(
				{
					collapsed: true,
					width: 288,
					collapsedGroups: [],
					extra: 1,
				},
			),
		);
		expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);

		storage.setItem(
			SIDEBAR_STORAGE_KEY,
			JSON.stringify(
				{
					collapsed: "yes",
					width: 288,
					collapsedGroups: [],
				},
			),
		);
		expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);

		storage.setItem(
			SIDEBAR_STORAGE_KEY,
			JSON.stringify(
				{
					collapsed: false,
					width: 9999,
					collapsedGroups: [],
				},
			),
		);
		expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);
	});

	it("is a no-op when storage throws", () =>
	{
		vi.spyOn(storage, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		const setItem = vi.spyOn(storage, "setItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});

		expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);
		expect(() =>
		{
			toggleSidebarCollapsed();
		}).not.toThrow();
		expect(setItem).toHaveBeenCalledTimes(1);
	});

	it("remembers the Recents row count, clamped to upstream's 21-row cap", () =>
	{
		const remembered = (count: number | undefined) =>
		{
			writeSidebarState(
				{
					...DEFAULT_SIDEBAR_STATE,
					...(count === undefined
						? {}
						:
							{
								recentsRowCount: count,
							}),
				},
			);
			return rememberedRecentsRows();
		};
		expect([remembered(undefined), remembered(4), remembered(50), remembered(0)]).toStrictEqual([
			undefined,
			4,
			21,
			0,
		]);
	});

	it("writes a larger Recents count after upstream's 2000ms debounce and a smaller one after 250ms, unless cancelled", () =>
	{
		vi.useFakeTimers();
		try
		{
			const after = (count: number, ms: number) =>
			{
				recordRecentsRowCount(count);
				const before = readSidebarState().recentsRowCount;
				vi.advanceTimersByTime(ms - 1);
				const early = readSidebarState().recentsRowCount;
				vi.advanceTimersByTime(1);
				return [before, early, readSidebarState().recentsRowCount];
			};
			const cancelled = () =>
			{
				recordRecentsRowCount(7);
				cancelPendingRecentsRowCount();
				vi.advanceTimersByTime(2000);
				return readSidebarState().recentsRowCount;
			};
			expect(
				{
					grow: after(9, 2000),
					shrink: after(4, 250),
					same: after(4, 2000),
					cancelled: cancelled(),
				},
			).toStrictEqual(
				{
					grow: [undefined, undefined, 9],
					shrink: [9, 9, 4],
					same: [4, 4, 4],
					cancelled: 4,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});
