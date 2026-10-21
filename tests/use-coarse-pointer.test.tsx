// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {renderToString} from "react-dom/server";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {COARSE_POINTER_QUERY, useCoarsePointer} from "../src/lib/use-phone-sheet";

type Listener = () => void;

function stubMatchMedia(matching: ReadonlySet<string>) {
	const lists = new Map<string, {matches: boolean; listeners: Set<Listener>}>();
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => {
			let state = lists.get(query);
			if (!state) {
				state = {matches: matching.has(query), listeners: new Set()};
				lists.set(query, state);
			}
			const entry = state;
			return {
				get matches() {
					return entry.matches;
				},
				media: query,
				onchange: null,
				addEventListener: (_type: string, listener: Listener) => entry.listeners.add(listener),
				removeEventListener: (_type: string, listener: Listener) => entry.listeners.delete(listener),
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			};
		}),
	);
	return {
		flip(query: string, matches: boolean) {
			const state = lists.get(query);
			if (!state) throw new Error(`no list for ${query}`);
			state.matches = matches;
			for (const listener of state.listeners) listener();
		},
	};
}

function Probe() {
	return <span>{String(useCoarsePointer())}</span>;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useCoarsePointer", () => {
	it("uses exactly upstream's (pointer: coarse) query", () => {
		expect(COARSE_POINTER_QUERY).toStrictEqual("(pointer: coarse)");
	});

	it("is true when (pointer: coarse) matches", () => {
		stubMatchMedia(new Set(["(pointer: coarse)"]));
		const {container} = render(<Probe />);
		expect(container.textContent).toStrictEqual("true");
	});

	it("ignores (hover: none) on a fine pointer", () => {
		stubMatchMedia(new Set(["(hover: none)", "(pointer: coarse), (hover: none)"]));
		const {container} = render(<Probe />);
		expect(container.textContent).toStrictEqual("false");
	});

	it("re-renders live when the pointer type changes", () => {
		const media = stubMatchMedia(new Set());
		const {container} = render(<Probe />);
		expect(container.textContent).toStrictEqual("false");
		act(() => {
			media.flip("(pointer: coarse)", true);
		});
		expect(container.textContent).toStrictEqual("true");
	});

	it("renders false on the server", () => {
		stubMatchMedia(new Set(["(pointer: coarse)"]));
		expect(renderToString(<Probe />)).toStrictEqual("<span>false</span>");
	});
});
