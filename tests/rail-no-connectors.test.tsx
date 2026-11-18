// @vitest-environment jsdom

import {renderHook} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {RAIL_NO_CONNECTORS_KEY, useRailNoConnectors} from "../src/lib/rail-no-connectors";
import {installLocalStorage} from "./fake-storage";

function seed(map: Record<string, unknown>)
{
	localStorage.setItem(RAIL_NO_CONNECTORS_KEY, JSON.stringify(map));
}

function stored(): unknown
{
	const raw = localStorage.getItem(RAIL_NO_CONNECTORS_KEY);
	return raw === null ? null : JSON.parse(raw);
}

interface Props
{
	sessionId: string;
	count: number | null;
	trusted: boolean;
}

function renderMemory(initial: Props)
{
	return renderHook(
		({sessionId, count, trusted}: Props) => useRailNoConnectors(sessionId, count, trusted),
		{
			initialProps: initial,
		},
	);
}

beforeEach(() =>
{
	installLocalStorage();
	vi.spyOn(Date, "now").mockReturnValue(9);
});

describe("useRailNoConnectors", () =>
{
	it("remembers nothing with empty storage", () =>
	{
		expect(
			renderMemory(
				{
					sessionId: "s1",
					count: null,
					trusted: false,
				},
			).result.current,
		).toBe(false);
	});

	it("reads the session's entry, else the last: fallback, the session's winning", () =>
	{
		seed(
			{
				s1:
				{
					none: true,
					at: 1,
				},
				s2:
				{
					none: false,
					at: 2,
				},
				"last:":
				{
					none: true,
					at: 1,
				},
			},
		);
		const read = (sessionId: string) =>
			renderMemory(
				{
					sessionId,
					count: null,
					trusted: false,
				},
			).result.current;

		expect(
			{
				s1: read("s1"),
				s2: read("s2"),
				unseen: read("s3"),
			},
		).toStrictEqual(
			{
				s1: true,
				s2: false,
				unseen: true,
			},
		);
	});

	it("keeps the flag it mounted with, and writes a known count to the session and last: keys", () =>
	{
		seed(
			{
				s1:
				{
					none: true,
					at: 1,
				},
			},
		);
		const hook = renderMemory(
			{
				sessionId: "s1",
				count: null,
				trusted: false,
			},
		);
		hook.rerender(
			{
				sessionId: "s1",
				count: 3,
				trusted: false,
			},
		);

		expect(
			{
				remembered: hook.result.current,
				stored: stored(),
			},
		).toStrictEqual(
			{
				remembered: true,
				stored:
				{
					s1:
					{
						none: false,
						at: 9,
					},
					"last:":
					{
						none: false,
						at: 9,
					},
				},
			},
		);
	});

	it("writes a zero count only once it is trusted, and never a null count", () =>
	{
		const hook = renderMemory(
			{
				sessionId: "s1",
				count: null,
				trusted: true,
			},
		);
		const afterNull = stored();
		hook.rerender(
			{
				sessionId: "s1",
				count: 0,
				trusted: false,
			},
		);
		const afterUntrusted = stored();
		hook.rerender(
			{
				sessionId: "s1",
				count: 0,
				trusted: true,
			},
		);

		expect(
			{
				afterNull,
				afterUntrusted,
				afterTrusted: stored(),
			},
		).toStrictEqual(
			{
				afterNull: null,
				afterUntrusted: null,
				afterTrusted:
				{
					s1:
					{
						none: true,
						at: 9,
					},
					"last:":
					{
						none: true,
						at: 9,
					},
				},
			},
		);
	});
});
