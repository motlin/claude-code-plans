// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {
	isMotionReduced,
	REDUCE_MOTION_ATTRIBUTE,
	REDUCED_MOTION_QUERY,
	subscribeReducedMotion,
	useReducedMotion,
} from "../src/lib/reduced-motion";

interface FakeQuery {
	matches: boolean;
	set: (matches: boolean) => void;
	listenerCount: () => number;
}

function stubMatchMedia(initial: boolean): FakeQuery {
	const listeners = new Set<() => void>();
	const state = {matches: initial};
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			get matches() {
				return query === REDUCED_MOTION_QUERY && state.matches;
			},
			addEventListener: (_type: string, listener: () => void) => {
				listeners.add(listener);
			},
			removeEventListener: (_type: string, listener: () => void) => {
				listeners.delete(listener);
			},
		})),
	);
	return {
		get matches() {
			return state.matches;
		},
		set: (matches: boolean) => {
			state.matches = matches;
			for (const listener of listeners) listener();
		},
		listenerCount: () => listeners.size,
	};
}

beforeEach(() => {
	document.documentElement.removeAttribute("data-reduce-motion");
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.documentElement.removeAttribute("data-reduce-motion");
});

describe("isMotionReduced", () => {
	it("is true for the root attribute alone, for the OS query alone, and false for neither", () => {
		const query = stubMatchMedia(false);
		const neither = isMotionReduced();
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const attribute = isMotionReduced();
		document.documentElement.removeAttribute("data-reduce-motion");
		query.set(true);
		const os = isMotionReduced();
		query.set(false);
		document.documentElement.setAttribute("data-reduce-motion", "false");
		const falseValue = isMotionReduced();

		expect({
			constants: {query: REDUCED_MOTION_QUERY, attribute: REDUCE_MOTION_ATTRIBUTE},
			neither,
			attribute,
			os,
			falseValue,
		}).toStrictEqual({
			constants: {query: "(prefers-reduced-motion: reduce)", attribute: "data-reduce-motion"},
			neither: false,
			attribute: true,
			os: true,
			falseValue: false,
		});
	});

	it("reads the attribute when matchMedia is unavailable", () => {
		vi.stubGlobal("matchMedia", undefined);
		const before = isMotionReduced();
		document.documentElement.setAttribute("data-reduce-motion", "true");

		expect({before, after: isMotionReduced()}).toStrictEqual({before: false, after: true});
	});
});

describe("useReducedMotion", () => {
	it("re-renders when the root attribute toggles and when the OS query fires change", async () => {
		const query = stubMatchMedia(false);
		const {result} = renderHook(() => useReducedMotion());
		const initial = result.current;

		await act(async () => {
			document.documentElement.setAttribute("data-reduce-motion", "true");
			await Promise.resolve();
		});
		const attributeOn = result.current;

		await act(async () => {
			document.documentElement.removeAttribute("data-reduce-motion");
			await Promise.resolve();
		});
		const attributeOff = result.current;

		act(() => {
			query.set(true);
		});
		const osOn = result.current;

		act(() => {
			query.set(false);
		});

		expect({initial, attributeOn, attributeOff, osOn, osOff: result.current}).toStrictEqual({
			initial: false,
			attributeOn: true,
			attributeOff: false,
			osOn: true,
			osOff: false,
		});
	});

	it("shares one observer and one media listener across subscribers and detaches after the last leaves", () => {
		const query = stubMatchMedia(false);
		const Observer = globalThis.MutationObserver;
		const constructed = vi.fn<() => void>();
		vi.stubGlobal(
			"MutationObserver",
			class extends Observer {
				constructor(callback: MutationCallback) {
					super(callback);
					constructed();
				}
			},
		);

		const first = subscribeReducedMotion(() => {});
		const second = subscribeReducedMotion(() => {});
		const shared = {observers: constructed.mock.calls.length, mediaListeners: query.listenerCount()};
		first();
		const afterFirst = query.listenerCount();
		second();

		expect({shared, afterFirst, afterLast: query.listenerCount()}).toStrictEqual({
			shared: {observers: 1, mediaListeners: 1},
			afterFirst: 1,
			afterLast: 0,
		});
	});
});
