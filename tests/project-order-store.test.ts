// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	PROJECT_ORDER_STORAGE_KEY,
	readProjectOrder,
	resetProjectOrder,
	setProjectOrder,
	useProjectOrder,
} from "../src/lib/project-order-store";
import {installLocalStorage} from "./fake-storage";

describe("project order store", () =>
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

	it("stores the order under ccp-projects-order and resets it by removing the key", () =>
	{
		const initial = readProjectOrder();
		setProjectOrder(["b", "a"]);
		const afterSet =
		{
			read: readProjectOrder(),
			raw: localStorage.getItem("ccp-projects-order"),
		};
		resetProjectOrder();

		expect(
			{
				key: PROJECT_ORDER_STORAGE_KEY,
				initial,
				afterSet,
				afterReset:
				{
					read: readProjectOrder(),
					raw: localStorage.getItem("ccp-projects-order"),
				},
			},
		).toStrictEqual(
			{
				key: "ccp-projects-order",
				initial: [],
				afterSet:
				{
					read: ["b", "a"],
					raw: '["b","a"]',
				},
				afterReset:
				{
					read: [],
					raw: null,
				},
			},
		);
	});

	it.each([
		["corrupt JSON", "{"],
		[
			"the wrong shape",
			JSON.stringify(
				{
					a: 1,
				},
			),
		],
	])("reads %s as no order", (_label, raw) =>
	{
		localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, raw);

		expect(readProjectOrder()).toStrictEqual([]);
	});

	it("normalizes a stored order: strings only, first duplicate kept", () =>
	{
		localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(["b", 1, "a", "b"]));

		expect(readProjectOrder()).toStrictEqual(["b", "a"]);
	});

	it("keeps working when storage throws", () =>
	{
		vi.spyOn(storage, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.spyOn(storage, "setItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.spyOn(storage, "removeItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});

		expect(() =>
		{
			setProjectOrder(["a"]);
			resetProjectOrder();
		}).not.toThrow();
		expect(readProjectOrder()).toStrictEqual([]);
	});

	it("updates hooks locally and from another tab's storage event", () =>
	{
		const hook = renderHook(() => useProjectOrder());
		act(() =>
		{
			setProjectOrder(["a"]);
		});
		const afterLocal = hook.result.current;
		act(() =>
		{
			localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, '["c","a"]');
			window.dispatchEvent(
				new StorageEvent(
					"storage",
					{
						key: PROJECT_ORDER_STORAGE_KEY,
						newValue: '["c","a"]',
					},
				),
			);
		});
		const afterOtherTab = hook.result.current;
		act(() =>
		{
			localStorage.clear();
			window.dispatchEvent(
				new StorageEvent(
					"storage",
					{
						key: null,
					},
				),
			);
		});

		expect(
			{
				afterLocal,
				afterOtherTab,
				afterClear: hook.result.current,
			},
		).toStrictEqual(
			{
				afterLocal: ["a"],
				afterOtherTab: ["c", "a"],
				afterClear: [],
			},
		);
	});
});
