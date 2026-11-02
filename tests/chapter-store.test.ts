// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	CHAPTER_STORAGE_KEY,
	LEGACY_CHAPTER_STORAGE_KEY,
	addUserChapter,
	readSessionChapters,
	removeUserChapter,
	renameChapter,
	setChapterHidden,
	toggleUserChapterAt,
	useSessionChapters,
} from "../src/lib/chapter-store";
import {installLocalStorage} from "./fake-storage";

const EMPTY =
{
	renames: {},
	hidden: [],
	userChapters: [],
};
const INTRO =
{
	id: "uch-fake-uuid-1",
	afterId: "message-intro",
	title: "Set up the repo",
	recordIndex: 4,
};
const TESTS =
{
	id: "uch-fake-uuid-2",
	afterId: "message-tests",
	title: "Run the tests",
	recordIndex: 20,
};

const stored = (): unknown => JSON.parse(localStorage.getItem(CHAPTER_STORAGE_KEY) ?? "null");

describe("chapter store", () =>
{
	beforeEach(() =>
	{
		installLocalStorage();
		let minted = 0;
		vi.spyOn(crypto, "randomUUID").mockImplementation(() =>
		{
			minted += 1;
			return `fake-uuid-${minted}` as ReturnType<typeof crypto.randomUUID>;
		});
	});

	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("has no chapters when storage is empty or corrupt", () =>
	{
		const empty = readSessionChapters("session-alice");
		localStorage.setItem(CHAPTER_STORAGE_KEY, "{not json");
		const corrupt = readSessionChapters("session-alice");
		localStorage.setItem(
			CHAPTER_STORAGE_KEY,
			JSON.stringify(
				{
					"session-alice":
					{
						userChapters: "nope",
					},
				},
			),
		);

		expect(
			{
				empty,
				corrupt,
				wrongShape: readSessionChapters("session-alice"),
			},
		).toStrictEqual(
			{
				empty: EMPTY,
				corrupt: EMPTY,
				wrongShape: EMPTY,
			},
		);
	});

	it("adds user chapters with a uch- id, per session, and ignores a second pin on the same message", () =>
	{
		const first = addUserChapter("session-alice", INTRO.afterId, INTRO.title, INTRO.recordIndex);
		const second = addUserChapter("session-alice", TESTS.afterId, TESTS.title, TESTS.recordIndex);
		const duplicate = addUserChapter("session-alice", INTRO.afterId, "Again", 4);
		const bob = addUserChapter("session-bob", INTRO.afterId, INTRO.title, INTRO.recordIndex);

		expect(
			{
				first,
				second,
				duplicate,
				bob,
				stored: stored(),
			},
		).toStrictEqual(
			{
				first: "uch-fake-uuid-1",
				second: "uch-fake-uuid-2",
				duplicate: null,
				bob: "uch-fake-uuid-3",
				stored:
				{
					"session-alice":
					{
						renames: {},
						hidden: [],
						userChapters: [INTRO, TESTS],
					},
					"session-bob":
					{
						renames: {},
						hidden: [],
						userChapters: [
							{
								...INTRO,
								id: "uch-fake-uuid-3",
							},
						],
					},
				},
			},
		);
	});

	it("removes a user chapter and drops the session once it holds nothing", () =>
	{
		addUserChapter("session-alice", INTRO.afterId, INTRO.title, INTRO.recordIndex);
		addUserChapter("session-alice", TESTS.afterId, TESTS.title, TESTS.recordIndex);
		removeUserChapter("session-alice", INTRO.id);
		const one = stored();
		removeUserChapter("session-alice", TESTS.id);

		expect(
			{
				one,
				none: stored(),
				chapters: readSessionChapters("session-alice"),
			},
		).toStrictEqual(
			{
				one:
				{
					"session-alice":
					{
						renames: {},
						hidden: [],
						userChapters: [TESTS],
					},
				},
				none: {},
				chapters: EMPTY,
			},
		);
	});

	it("toggles the pin on a message: a first press adds it and a second removes it", () =>
	{
		toggleUserChapterAt("session-alice", INTRO.afterId, INTRO.title, INTRO.recordIndex);
		const pinned = stored();
		toggleUserChapterAt("session-alice", INTRO.afterId, INTRO.title, INTRO.recordIndex);

		expect(
			{
				pinned,
				unpinned: stored(),
			},
		).toStrictEqual(
			{
				pinned:
				{
					"session-alice":
					{
						renames: {},
						hidden: [],
						userChapters: [INTRO],
					},
				},
				unpinned: {},
			},
		);
	});

	it("renames a user chapter in place and records a Claude chapter's rename under renames", () =>
	{
		addUserChapter("session-alice", INTRO.afterId, INTRO.title, INTRO.recordIndex);
		renameChapter("session-alice", INTRO.id, "Bootstrap");
		renameChapter("session-alice", "toolu_fake_chapter", "Planning");

		expect(stored()).toStrictEqual(
			{
				"session-alice":
				{
					renames:
					{
						toolu_fake_chapter: "Planning",
					},
					hidden: [],
					userChapters: [
						{
							...INTRO,
							title: "Bootstrap",
						},
					],
				},
			},
		);
	});

	it("hides a chapter once however often it is hidden, and shows it again", () =>
	{
		setChapterHidden("session-alice", "toolu_fake_chapter", true);
		setChapterHidden("session-alice", "toolu_fake_other", true);
		setChapterHidden("session-alice", "toolu_fake_chapter", true);
		const hidden = stored();
		setChapterHidden("session-alice", "toolu_fake_chapter", false);
		const shown = stored();
		setChapterHidden("session-alice", "toolu_fake_other", false);

		expect(
			{
				hidden,
				shown,
				cleared: stored(),
			},
		).toStrictEqual(
			{
				hidden:
				{
					"session-alice":
					{
						renames: {},
						hidden: ["toolu_fake_other", "toolu_fake_chapter"],
						userChapters: [],
					},
				},
				shown:
				{
					"session-alice":
					{
						renames: {},
						hidden: ["toolu_fake_other"],
						userChapters: [],
					},
				},
				cleared: {},
			},
		);
	});

	it("migrates the v1 pins on first read, keeping v2 entries, and deletes the v1 key", () =>
	{
		localStorage.setItem(
			LEGACY_CHAPTER_STORAGE_KEY,
			JSON.stringify(
				{
					"session-alice": [
						{
							uuid: "message-intro",
							label: "Set up the repo",
							recordIndex: 4,
						},
						{
							uuid: "message-tests",
							label: "Run the tests",
							recordIndex: 20,
						},
					],
					"session-bob": [
						{
							uuid: "message-bob",
							label: "Bob's pin",
							recordIndex: 2,
						},
					],
				},
			),
		);
		localStorage.setItem(
			CHAPTER_STORAGE_KEY,
			JSON.stringify(
				{
					"session-alice":
					{
						renames:
						{
							toolu_fake_chapter: "Planning",
						},
						hidden: [],
						userChapters: [
							{
								id: "uch-kept",
								afterId: "message-intro",
								title: "Kept title",
								recordIndex: 4,
							},
						],
					},
				},
			),
		);
		const alice = readSessionChapters("session-alice");

		expect(
			{
				alice,
				stored: stored(),
				legacy: localStorage.getItem(LEGACY_CHAPTER_STORAGE_KEY),
			},
		).toStrictEqual(
			{
				alice:
				{
					renames:
					{
						toolu_fake_chapter: "Planning",
					},
					hidden: [],
					userChapters: [
						{
							id: "uch-kept",
							afterId: "message-intro",
							title: "Kept title",
							recordIndex: 4,
						},
						INTRO_AS_SECOND,
					],
				},
				stored:
				{
					"session-alice":
					{
						renames:
						{
							toolu_fake_chapter: "Planning",
						},
						hidden: [],
						userChapters: [
							{
								id: "uch-kept",
								afterId: "message-intro",
								title: "Kept title",
								recordIndex: 4,
							},
							INTRO_AS_SECOND,
						],
					},
					"session-bob":
					{
						renames: {},
						hidden: [],
						userChapters: [
							{
								id: "uch-fake-uuid-2",
								afterId: "message-bob",
								title: "Bob's pin",
								recordIndex: 2,
							},
						],
					},
				},
				legacy: null,
			},
		);
	});

	it("drops a corrupt v1 blob without touching v2", () =>
	{
		localStorage.setItem(LEGACY_CHAPTER_STORAGE_KEY, "{not json");
		const alice = readSessionChapters("session-alice");

		expect(
			{
				alice,
				stored: stored(),
				legacy: localStorage.getItem(LEGACY_CHAPTER_STORAGE_KEY),
			},
		).toStrictEqual(
			{
				alice: EMPTY,
				stored: null,
				legacy: null,
			},
		);
	});

	it("re-renders subscribers when a chapter is pinned", () =>
	{
		const {result} = renderHook(() => useSessionChapters("session-alice"));
		const before = result.current;
		act(() =>
		{
			addUserChapter("session-alice", INTRO.afterId, INTRO.title, INTRO.recordIndex);
		});

		expect(
			{
				before,
				after: result.current,
			},
		).toStrictEqual(
			{
				before: EMPTY,
				after:
				{
					renames: {},
					hidden: [],
					userChapters: [INTRO],
				},
			},
		);
	});
});

/** The v1 pin on message-tests, migrated after the pin on message-intro was skipped as already held. */
const INTRO_AS_SECOND =
{
	id: "uch-fake-uuid-1",
	afterId: "message-tests",
	title: "Run the tests",
	recordIndex: 20,
};
