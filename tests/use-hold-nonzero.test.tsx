// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useFirstWindow, useHoldNonzero} from "../src/lib/use-hold-nonzero";

beforeEach(() =>
{
	vi.useFakeTimers();
});

afterEach(() =>
{
	vi.useRealTimers();
});

function advance(ms: number)
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
}

describe("useFirstWindow", () =>
{
	it("is true for the first window an activation lasts, and never again once it fired", () =>
	{
		const hook = renderHook(
			({active}: {active: boolean}) => useFirstWindow(active, 3000),
			{
				initialProps:
				{
					active: true,
				},
			},
		);
		const seen: boolean[] = [hook.result.current];
		advance(2999);
		seen.push(hook.result.current);
		advance(1);
		seen.push(hook.result.current);
		hook.rerender(
			{
				active: false,
			},
		);
		hook.rerender(
			{
				active: true,
			},
		);
		seen.push(hook.result.current);

		expect(seen).toStrictEqual([true, true, false, false]);
	});

	it("restarts the timer when the activation ends before it fires", () =>
	{
		const hook = renderHook(
			({active}: {active: boolean}) => useFirstWindow(active, 3000),
			{
				initialProps:
				{
					active: true,
				},
			},
		);
		advance(1000);
		hook.rerender(
			{
				active: false,
			},
		);
		const off = hook.result.current;
		hook.rerender(
			{
				active: true,
			},
		);
		advance(2999);
		const held = hook.result.current;
		advance(1);

		expect([off, held, hook.result.current]).toStrictEqual([false, true, false]);
	});
});

describe("useHoldNonzero", () =>
{
	it("holds the last nonempty value for 3s after it drops to empty", () =>
	{
		const full = ["a", "b"];
		const empty: string[] = [];
		const hook = renderHook(
			({value}: {value: string[]}) => useHoldNonzero(value, value.length, true),
			{
				initialProps:
				{
					value: full,
				},
			},
		);
		hook.rerender(
			{
				value: empty,
			},
		);
		const dropped = hook.result.current;
		advance(2999);
		const late = hook.result.current;
		advance(1);

		expect([dropped, late, hook.result.current]).toStrictEqual([full, full, empty]);
	});

	it("passes the value straight through when disabled", () =>
	{
		const hook = renderHook(
			({value}: {value: string[]}) => useHoldNonzero(value, value.length, false),
			{
				initialProps:
				{
					value: ["a"],
				},
			},
		);
		const empty: string[] = [];
		hook.rerender(
			{
				value: empty,
			},
		);

		expect(hook.result.current).toBe(empty);
	});
});
