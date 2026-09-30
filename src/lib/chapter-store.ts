import {useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * Per-browser "Pin as chapter" marks, keyed by session: each chapter names a
 * transcript message by uuid, with a short label and the session-absolute
 * record index that orders the chapter chips.
 */
export const CHAPTER_STORAGE_KEY = "ccp-chapters";

const ChapterSchema = z.strictObject({
	uuid: z.string(),
	label: z.string(),
	recordIndex: z.number().int().nonnegative(),
});

export type Chapter = z.infer<typeof ChapterSchema>;

const ChapterStateSchema = z.record(z.string(), z.array(ChapterSchema));

type ChapterState = z.infer<typeof ChapterStateSchema>;

const NO_CHAPTERS: readonly Chapter[] = [];
const EMPTY_STATE: ChapterState = {};

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: ChapterState = EMPTY_STATE;

function readRaw(): string | null {
	try {
		return localStorage.getItem(CHAPTER_STORAGE_KEY);
	} catch {
		return null;
	}
}

function parse(raw: string | null): ChapterState {
	if (raw === null) return EMPTY_STATE;
	try {
		const result = ChapterStateSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : EMPTY_STATE;
	} catch {
		return EMPTY_STATE;
	}
}

function readState(): ChapterState {
	const raw = readRaw();
	if (raw !== cachedRaw) {
		cachedRaw = raw;
		cachedState = parse(raw);
	}
	return cachedState;
}

function writeState(state: ChapterState): void {
	try {
		localStorage.setItem(CHAPTER_STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage can be denied or full; chapters are best-effort per browser.
	}
	for (const listener of listeners) listener();
}

function writeChapters(sessionId: string, chapters: readonly Chapter[]): void {
	const rest = Object.fromEntries(Object.entries(readState()).filter(([key]) => key !== sessionId));
	writeState(chapters.length === 0 ? rest : {...rest, [sessionId]: [...chapters]});
}

/** A session's chapters in transcript order; absent, corrupt or unreadable storage yields none. */
export function readChapters(sessionId: string): readonly Chapter[] {
	return readState()[sessionId] ?? NO_CHAPTERS;
}

/** Pin the chapter, or unpin it when its message is already a chapter. */
export function toggleChapter(sessionId: string, chapter: Chapter): void {
	const chapters = readChapters(sessionId);
	if (chapters.some((existing) => existing.uuid === chapter.uuid)) {
		removeChapter(sessionId, chapter.uuid);
		return;
	}
	writeChapters(
		sessionId,
		[...chapters, chapter].sort((a, b) => a.recordIndex - b.recordIndex),
	);
}

export function removeChapter(sessionId: string, uuid: string): void {
	writeChapters(
		sessionId,
		readChapters(sessionId).filter((chapter) => chapter.uuid !== uuid),
	);
}

function onStorage(event: StorageEvent): void {
	if (event.key === null || event.key === CHAPTER_STORAGE_KEY) {
		for (const listener of listeners) listener();
	}
}

function subscribe(listener: () => void): () => void {
	if (listeners.size === 0) window.addEventListener("storage", onStorage);
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) window.removeEventListener("storage", onStorage);
	};
}

/** Live chapters for one session, kept in sync across tabs via the `storage` event. */
export function useChapters(sessionId: string): readonly Chapter[] {
	return useSyncExternalStore(
		subscribe,
		() => readChapters(sessionId),
		() => NO_CHAPTERS,
	);
}
