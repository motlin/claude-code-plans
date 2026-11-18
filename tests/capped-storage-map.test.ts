// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {createCappedStorageMap} from "../src/lib/capped-storage-map";
import {installLocalStorage} from "./fake-storage";

const KEY = "epitaxy.test.v1";

interface Entry
{
	none: boolean;
	at: number;
}

function isEntry(value: unknown): value is Entry
{
	return typeof value === "object" && value !== null && "none" in value && typeof value.none === "boolean";
}

function stored(): unknown
{
	const raw = localStorage.getItem(KEY);
	return raw === null ? null : JSON.parse(raw);
}

beforeEach(() =>
{
	installLocalStorage();
});

afterEach(() =>
{
	vi.restoreAllMocks();
});

describe("createCappedStorageMap", () =>
{
	const map = createCappedStorageMap<Entry>(
		{
			key: KEY,
			cap: 200,
			valid: isEntry,
		},
	);

	it("stamps a written value with Date.now and reads it back, missing keys reading undefined", () =>
	{
		vi.spyOn(Date, "now").mockReturnValue(1000);
		map.write(
			"s1",
			{
				none: true,
			},
		);

		expect(
			{
				stored: stored(),
				hit: map.read("s1"),
				miss: map.read("nope"),
			},
		).toStrictEqual(
			{
				stored:
				{
					s1:
					{
						none: true,
						at: 1000,
					},
				},
				hit:
				{
					none: true,
					at: 1000,
				},
				miss: undefined,
			},
		);
	});

	it("reads an entry that fails valid as undefined", () =>
	{
		localStorage.setItem(
			KEY,
			JSON.stringify(
				{
					s1:
					{
						none: "yes",
					},
				},
			),
		);

		expect(map.read("s1")).toBeUndefined();
	});

	it("reads corrupt JSON as empty, and a write replaces it with only the new key", () =>
	{
		localStorage.setItem(KEY, "{");
		vi.spyOn(Date, "now").mockReturnValue(5);
		const before = map.read("s1");
		map.write(
			"s2",
			{
				none: false,
			},
		);

		expect(
			{
				before,
				stored: stored(),
			},
		).toStrictEqual(
			{
				before: undefined,
				stored:
				{
					s2:
					{
						none: false,
						at: 5,
					},
				},
			},
		);
	});

	it("evicts the oldest entries by at above the cap", () =>
	{
		const small = createCappedStorageMap<Entry>(
			{
				key: KEY,
				cap: 2,
				valid: isEntry,
			},
		);
		const now = vi.spyOn(Date, "now");
		for (const [at, id] of [
			[1, "a"],
			[2, "b"],
			[3, "c"],
		] as const)
		{
			now.mockReturnValue(at);
			small.write(
				id,
				{
					none: true,
				},
			);
		}

		expect(stored()).toStrictEqual(
			{
				b:
				{
					none: true,
					at: 2,
				},
				c:
				{
					none: true,
					at: 3,
				},
			},
		);
	});

	it("deletes the key on a null write", () =>
	{
		vi.spyOn(Date, "now").mockReturnValue(1);
		map.write(
			"s1",
			{
				none: true,
			},
		);
		map.write(
			"s2",
			{
				none: false,
			},
		);
		map.write("s1", null);

		expect(stored()).toStrictEqual(
			{
				s2:
				{
					none: false,
					at: 1,
				},
			},
		);
	});

	it("swallows a throwing setItem and reads undefined from a throwing getItem", () =>
	{
		vi.spyOn(localStorage, "setItem").mockImplementation(() =>
		{
			throw new Error("quota");
		});
		map.write(
			"s1",
			{
				none: true,
			},
		);
		vi.spyOn(localStorage, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});

		expect(map.read("s1")).toBeUndefined();
	});
});
