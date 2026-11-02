import {useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * Per-browser chapter edits, keyed by session, in the shape of upstream claude.ai/code's
 * `epitaxy-chapters-v2` store: the user's "Pin as chapter" marks, plus the renames and
 * deletions of Claude's own chapters.
 */
export const CHAPTER_STORAGE_KEY = "ccp-chapters-v2";

/** The v1 store (pins only, as `{uuid, label, recordIndex}` lists), migrated on first read. */
export const LEGACY_CHAPTER_STORAGE_KEY = "ccp-chapters";

const UserChapterSchema = z.strictObject(
	{
		/** `uch-<uuid>`, which the heading's `epitaxy-ch-` anchor uses. */
		id: z.string(),
		/** The uuid of the pinned message, which the chapter heads. */
		afterId: z.string(),
		title: z.string(),
		/** The pinned message's session-absolute record index, which orders it among Claude's chapters. */
		recordIndex: z.number().int().nonnegative(),
	},
);

export type UserChapter = z.infer<typeof UserChapterSchema>;

const SessionChaptersSchema = z.strictObject(
	{
		/** Claude chapter id to its new title. */
		renames: z.record(z.string(), z.string()),
		/** The Claude chapters the user deleted. */
		hidden: z.array(z.string()),
		userChapters: z.array(UserChapterSchema),
	},
);

export type SessionChapters = z.infer<typeof SessionChaptersSchema>;

const ChapterStateSchema = z.record(z.string(), SessionChaptersSchema);

type ChapterState = z.infer<typeof ChapterStateSchema>;

const LegacyStateSchema = z.record(
	z.string(),
	z.array(
		z.strictObject(
			{
				uuid: z.string(),
				label: z.string(),
				recordIndex: z.number().int().nonnegative(),
			},
		),
	),
);

const NO_CHAPTERS: SessionChapters =
{
	renames: {},
	hidden: [],
	userChapters: [],
};
const EMPTY_STATE: ChapterState = {};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: ChapterState = EMPTY_STATE;

function readRaw(key: string): string | null
{
	try
	{
		return localStorage.getItem(key);
	}
	catch
	{
		return null;
	}
}

function parse<T>(schema: z.ZodType<T>, raw: string | null): T | undefined
{
	if (raw === null) return undefined;
	try
	{
		const result = schema.safeParse(JSON.parse(raw));
		return result.success ? result.data : undefined;
	}
	catch
	{
		return undefined;
	}
}

function userChapterId(): string
{
	return `uch-${crypto.randomUUID()}`;
}

/** Folds the v1 pins into the v2 store and deletes the v1 key; a message v2 already pins keeps its v2 chapter. */
function migrateLegacy(): void
{
	const legacyRaw = readRaw(LEGACY_CHAPTER_STORAGE_KEY);
	if (legacyRaw === null) return;
	const legacy = parse(LegacyStateSchema, legacyRaw);
	try
	{
		if (legacy !== undefined)
		{
			const state =
			{
				...parse(ChapterStateSchema, readRaw(CHAPTER_STORAGE_KEY)),
			};
			for (const [sessionId, pins] of Object.entries(legacy))
			{
				const session = state[sessionId] ?? NO_CHAPTERS;
				const userChapters = [...session.userChapters];
				for (const pin of pins)
				{
					if (userChapters.some((chapter) => chapter.afterId === pin.uuid)) continue;
					userChapters.push(
						{
							id: userChapterId(),
							afterId: pin.uuid,
							title: pin.label,
							recordIndex: pin.recordIndex,
						},
					);
				}
				if (userChapters.length > 0)
					state[sessionId] =
					{
						...session,
						userChapters,
					};
			}
			localStorage.setItem(CHAPTER_STORAGE_KEY, JSON.stringify(state));
		}
		localStorage.removeItem(LEGACY_CHAPTER_STORAGE_KEY);
	}
	catch
	{
		// Storage can be denied or full; the v1 pins stay put for a later read.
	}
}

function readState(): ChapterState
{
	migrateLegacy();
	const raw = readRaw(CHAPTER_STORAGE_KEY);
	if (raw !== cachedRaw)
	{
		cachedRaw = raw;
		cachedState = parse(ChapterStateSchema, raw) ?? EMPTY_STATE;
	}
	return cachedState;
}

function isEmpty(session: SessionChapters): boolean
{
	return (
		session.userChapters.length === 0 && session.hidden.length === 0 && Object.keys(session.renames).length === 0
	);
}

/** Applies `change` to one session's chapters, as upstream's `JO`; a session left holding nothing is dropped. */
function update(sessionId: string, change: (session: SessionChapters) => SessionChapters): void
{
	const state = readState();
	const session = state[sessionId] ?? NO_CHAPTERS;
	const next = change(session);
	if (next === session) return;
	const rest = Object.fromEntries(Object.entries(state).filter(([key]) => key !== sessionId));
	try
	{
		localStorage.setItem(
			CHAPTER_STORAGE_KEY,
			JSON.stringify(
				isEmpty(next)
					? rest
					:
						{
							...rest,
							[sessionId]: next,
						},
			),
		);
	}
	catch
	{
		// Storage can be denied or full; chapters are best-effort per browser.
	}
	for (const listener of listeners) listener();
}

/** A session's chapter edits; absent, corrupt or unreadable storage yields none. */
export function readSessionChapters(sessionId: string): SessionChapters
{
	return readState()[sessionId] ?? NO_CHAPTERS;
}

/** Retitle a chapter: a user chapter in place, anything else (one of Claude's) through `renames`. */
export function renameChapter(sessionId: string, id: string, title: string): void
{
	update(sessionId, (session) =>
		session.userChapters.some((chapter) => chapter.id === id)
			?
				{
					...session,
					userChapters: session.userChapters.map((chapter) =>
						chapter.id === id
							?
								{
									...chapter,
									title,
								}
							: chapter,
					),
				}
			:
				{
					...session,
					renames:
					{
						...session.renames,
						[id]: title,
					},
				},
	);
}

/** Hide one of Claude's chapters (its Delete), or show it again. */
export function setChapterHidden(sessionId: string, id: string, hidden: boolean): void
{
	update(sessionId, (session) =>
	{
		const rest = session.hidden.filter((existing) => existing !== id);
		return {
			...session,
			hidden: hidden ? [...rest, id] : rest,
		};
	});
}

/** Pin a message as a chapter and return the new chapter's id, or null when the message is already pinned. */
export function addUserChapter(sessionId: string, afterId: string, title: string, recordIndex: number): string | null
{
	let id: string | null = null;
	update(sessionId, (session) =>
	{
		if (session.userChapters.some((chapter) => chapter.afterId === afterId)) return session;
		id = userChapterId();
		return {
			...session,
			userChapters: [
				...session.userChapters,
				{
					id,
					afterId,
					title,
					recordIndex,
				},
			],
		};
	});
	return id;
}

export function removeUserChapter(sessionId: string, id: string): void
{
	update(sessionId, (session) => (
	{
		...session,
		userChapters: session.userChapters.filter((chapter) => chapter.id !== id),
	}));
}

/** The message's "Pin as chapter" toggle: pin it, or unpin it when it already heads a chapter. */
export function toggleUserChapterAt(sessionId: string, afterId: string, title: string, recordIndex: number): void
{
	const pinned = readSessionChapters(sessionId).userChapters.find((chapter) => chapter.afterId === afterId);
	if (pinned === undefined) addUserChapter(sessionId, afterId, title, recordIndex);
	else removeUserChapter(sessionId, pinned.id);
}

function onStorage(event: StorageEvent): void
{
	if (event.key === null || event.key === CHAPTER_STORAGE_KEY || event.key === LEGACY_CHAPTER_STORAGE_KEY)
	{
		for (const listener of listeners) listener();
	}
}

function subscribe(listener: () => void): () => void
{
	if (listeners.size === 0) window.addEventListener("storage", onStorage);
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
		if (listeners.size === 0) window.removeEventListener("storage", onStorage);
	};
}

/** Live chapter edits for one session, kept in sync across tabs via the `storage` event. */
export function useSessionChapters(sessionId: string): SessionChapters
{
	return useSyncExternalStore(
		subscribe,
		() => readSessionChapters(sessionId),
		() => NO_CHAPTERS,
	);
}
