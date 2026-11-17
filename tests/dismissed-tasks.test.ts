// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {dismissTasks, resetDismissedTasksForTests, undismissTasks, useDismissedTasks} from "../src/lib/dismissed-tasks";

const KEY = "epitaxy.dismissedTasksMap";

function stored(): unknown
{
	const raw = localStorage.getItem(KEY);
	return raw === null ? null : JSON.parse(raw);
}

beforeEach(() =>
{
	localStorage.clear();
	resetDismissedTasksForTests();
});

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("dismissed tasks, as upstream's epitaxy.dismissedTasksMap store", () =>
{
	it("persists a session's dismissed ids", () =>
	{
		dismissTasks("s1", ["a", "b"]);

		expect(stored()).toStrictEqual(
			{
				s1: ["a", "b"],
			},
		);
	});

	it("leaves storage unwritten when nothing changes", () =>
	{
		dismissTasks("s1", ["a"]);
		const setItem = vi.spyOn(Storage.prototype, "setItem");
		dismissTasks("s1", ["a"]);
		dismissTasks("s1", []);
		undismissTasks("s1", ["z"]);

		expect(setItem.mock.calls).toStrictEqual([]);
	});

	it("removes ids, dropping the session once its set is empty", () =>
	{
		dismissTasks("s1", ["a", "b"]);
		undismissTasks("s1", ["a"]);
		const afterOne = stored();
		undismissTasks("s1", ["b"]);

		expect(
			{
				afterOne,
				afterAll: stored(),
			},
		).toStrictEqual(
			{
				afterOne:
				{
					s1: ["b"],
				},
				afterAll: {},
			},
		);
	});

	it("keeps the 100 most recently written sessions", () =>
	{
		for (let index = 0; index < 100; index++) dismissTasks(`s${index}`, ["a"]);
		dismissTasks("s1", ["b"]);
		dismissTasks("s100", ["a"]);
		const sessions = Object.keys(stored() as object);

		expect(
			{
				count: sessions.length,
				s0: sessions.includes("s0"),
				s1: sessions.includes("s1"),
				s100: sessions.includes("s100"),
				last: sessions.at(-2),
			},
		).toStrictEqual(
			{
				count: 100,
				s0: false,
				s1: true,
				s100: true,
				last: "s1",
			},
		);
	});

	it("persists only a session's last 1000 ids", () =>
	{
		const ids = Array.from(
			{
				length: 1001,
			},
			(_, index) => `t${index}`,
		);
		dismissTasks("s1", ids);

		expect(stored()).toStrictEqual(
			{
				s1: ids.slice(1),
			},
		);
	});

	it("loads only non-empty arrays of strings from storage", () =>
	{
		localStorage.setItem(
			KEY,
			JSON.stringify(
				{
					s1: ["a", 3, "b"],
					s2: [],
					s3: "x",
				},
			),
		);
		const {result} = renderHook(() => [useDismissedTasks("s1"), useDismissedTasks("s2"), useDismissedTasks("s3")]);

		expect(result.current.map((set) => [...set])).toStrictEqual([["a", "b"], [], []]);
	});

	it.each(["[]", "{bad", "null", "3"])("reads %s as no dismissals", (raw) =>
	{
		localStorage.setItem(KEY, raw);
		const {result} = renderHook(() => useDismissedTasks("s1"));

		expect([...result.current]).toStrictEqual([]);
	});

	it("still dismisses in memory when storage throws", () =>
	{
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() =>
		{
			throw new Error("quota");
		});
		const {result} = renderHook(() => useDismissedTasks("s1"));
		act(() =>
		{
			dismissTasks("s1", ["a"]);
		});

		expect([...result.current]).toStrictEqual(["a"]);
	});

	it("re-renders on dismiss and shares one empty set across unknown sessions", () =>
	{
		const {result} = renderHook(() =>
		{
			return {
				s1: useDismissedTasks("s1"),
				unknownA: useDismissedTasks("unknown-a"),
				unknownB: useDismissedTasks("unknown-b"),
			};
		});
		const sameEmpty = result.current.unknownA === result.current.unknownB;
		act(() =>
		{
			dismissTasks("s1", ["a"]);
		});

		expect(
			{
				sameEmpty,
				s1: [...result.current.s1],
			},
		).toStrictEqual(
			{
				sameEmpty: true,
				s1: ["a"],
			},
		);
	});
});
