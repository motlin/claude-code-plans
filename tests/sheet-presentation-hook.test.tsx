// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SHEET_QUERY, useSheetPresentation} from "../src/components/ui/sheet-presentation";

let coarseNarrow = false;
const listeners = new Set<() => void>();

function setCoarseNarrow(value: boolean) {
	coarseNarrow = value;
	act(() => {
		for (const listener of listeners) listener();
	});
}

beforeEach(() => {
	coarseNarrow = false;
	listeners.clear();
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			get matches() {
				return query === SHEET_QUERY && coarseNarrow;
			},
			media: query,
			onchange: null,
			addEventListener: (_type: string, listener: () => void) => {
				listeners.add(listener);
			},
			removeEventListener: (_type: string, listener: () => void) => {
				listeners.delete(listener);
			},
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useSheetPresentation", () => {
	it("latches a sheet at open, holds it through the exit animation, and recomputes on the next open", () => {
		coarseNarrow = true;
		const {result, rerender} = renderHook(({open}: {open: boolean}) => useSheetPresentation(open), {
			initialProps: {open: false},
		});
		rerender({open: true});
		expect(result.current.sheet).toBe(true);

		setCoarseNarrow(false);
		expect(result.current.sheet).toBe(true);

		rerender({open: false});
		expect(result.current.sheet).toBe(true);

		act(() => {
			result.current.onOpenChangeComplete(false);
		});
		rerender({open: true});
		expect(result.current.sheet).toBe(false);
	});

	it("keeps an anchored decision when the viewport turns coarse and narrow while open", () => {
		const {result, rerender} = renderHook(({open}: {open: boolean}) => useSheetPresentation(open), {
			initialProps: {open: false},
		});
		rerender({open: true});
		expect(result.current.sheet).toBe(false);

		setCoarseNarrow(true);
		expect(result.current.sheet).toBe(false);
	});

	it("follows the media query live while closed", () => {
		const {result} = renderHook(() => useSheetPresentation(false));
		const observed = [result.current.sheet];
		setCoarseNarrow(true);
		observed.push(result.current.sheet);
		setCoarseNarrow(false);
		observed.push(result.current.sheet);
		expect(observed).toStrictEqual([false, true, false]);
	});

	it("never sheets an uncloseable overlay under auto", () => {
		coarseNarrow = true;
		const {result} = renderHook(() => useSheetPresentation(true, {closable: false}));
		expect(result.current.sheet).toBe(false);
	});
});
