// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {beforeEach, describe, expect, it} from "vite-plus/test";

import {CHAPTER_STORAGE_KEY, readChapters, removeChapter, toggleChapter, useChapters} from "../src/lib/chapter-store";
import {installLocalStorage} from "./fake-storage";

const INTRO = {uuid: "message-intro", label: "Set up the repo", recordIndex: 4};
const TESTS = {uuid: "message-tests", label: "Run the tests", recordIndex: 20};

describe("chapter store", () => {
	beforeEach(() => {
		installLocalStorage();
	});

	it("has no chapters when storage is empty or corrupt", () => {
		const empty = readChapters("session-alice");
		localStorage.setItem(CHAPTER_STORAGE_KEY, "{not json");
		expect({empty, corrupt: readChapters("session-alice")}).toStrictEqual({empty: [], corrupt: []});
	});

	it("pins chapters per session in transcript order and unpins on a second toggle", () => {
		toggleChapter("session-alice", TESTS);
		toggleChapter("session-alice", INTRO);
		toggleChapter("session-bob", INTRO);
		const pinned = readChapters("session-alice");
		toggleChapter("session-alice", TESTS);

		expect({
			pinned,
			afterToggle: readChapters("session-alice"),
			bob: readChapters("session-bob"),
			stored: JSON.parse(localStorage.getItem(CHAPTER_STORAGE_KEY) ?? "null"),
		}).toStrictEqual({
			pinned: [INTRO, TESTS],
			afterToggle: [INTRO],
			bob: [INTRO],
			stored: {"session-alice": [INTRO], "session-bob": [INTRO]},
		});
	});

	it("removes a chapter and drops the session once it has none", () => {
		toggleChapter("session-alice", INTRO);
		removeChapter("session-alice", INTRO.uuid);

		expect({
			chapters: readChapters("session-alice"),
			stored: JSON.parse(localStorage.getItem(CHAPTER_STORAGE_KEY) ?? "null"),
		}).toStrictEqual({chapters: [], stored: {}});
	});

	it("re-renders subscribers when a chapter is pinned", () => {
		const {result} = renderHook(() => useChapters("session-alice"));
		const before = result.current;
		act(() => toggleChapter("session-alice", INTRO));

		expect({before, after: result.current}).toStrictEqual({before: [], after: [INTRO]});
	});
});
