// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import
{
	clearFamilyHeads,
	publishFamilyHeads,
	resetFamilyHeadsStore,
	useFamilyHeads,
} from "../src/lib/sidebar-family-heads-store";

afterEach(resetFamilyHeadsStore);

describe("sidebar family heads store", () =>
{
	it("clears only for the owner that published", () =>
	{
		const a = Symbol("a");
		const b = Symbol("b");
		const {result} = renderHook(() => useFamilyHeads());
		expect(result.current).toBeNull();

		act(() =>
		{
			publishFamilyHeads(a, ["h1"]);
		});
		expect(result.current).toStrictEqual(["h1"]);

		act(() =>
		{
			clearFamilyHeads(b);
		});
		expect(result.current).toStrictEqual(["h1"]);

		act(() =>
		{
			clearFamilyHeads(a);
		});
		expect(result.current).toBeNull();
	});
});
