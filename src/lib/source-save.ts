import {assertNever} from "./assert-never";

/**
 * Save state machine and autosave scheduler shared by the editable source views (Files
 * viewer and memory dialog), ported from upstream's shared viewer (`cd2efac6e`, `gS`/`hS`)
 * and File editor (`cbd02b8f2`, the idle timer and flush triggers).
 */

/** Upstream `yd`: the idle timer restarts on every doc change. */
export const AUTO_SAVE_DELAY_MS = 1000;

export type SaveReason = "idle" | "blur" | "hidden" | "unload" | "unmount" | "explicit";

export type SaveError = {kind: "writeFailed"} | {kind: "conflict"} | {kind: "missing"} | {kind: "denied"};

export interface SaveState {
	saved: string;
	draft: string;
	etag: string | null;
	inFlight: boolean;
	queued: string | null;
	error: SaveError | null;
}

export type SaveEvent =
	| {type: "edit"; draft: string}
	| {type: "saveStart"}
	| {type: "saveOk"; etag: string | null; text: string}
	| {type: "saveFail"; error: SaveError}
	| {type: "discard"}
	| {type: "override"};

/** `next` is a queued draft to write now that the in-flight save has settled. */
export interface SaveTransition {
	state: SaveState;
	next: string | null;
}

export function initialSaveState(saved: string, etag: string | null): SaveState {
	return {saved, draft: saved, etag, inFlight: false, queued: null, error: null};
}

export function reduceSave(state: SaveState, event: SaveEvent): SaveTransition {
	switch (event.type) {
		case "edit":
			return {
				state: {...state, draft: event.draft, queued: state.inFlight ? event.draft : state.queued},
				next: null,
			};
		case "saveStart":
			return {state: {...state, inFlight: true, queued: null}, next: null};
		case "saveOk":
			return {
				state: {...state, saved: event.text, etag: event.etag, inFlight: false, queued: null, error: null},
				next: state.queued,
			};
		case "saveFail":
			return {state: {...state, inFlight: false, queued: null, error: event.error}, next: null};
		case "discard":
			return {state: {...state, draft: state.saved, queued: null, error: null}, next: null};
		case "override":
			return {state: {...state, etag: null, error: null}, next: null};
		default:
			return assertNever(event);
	}
}

export function editorDirty(state: SaveState): boolean {
	return state.draft !== state.saved;
}

/** Upstream `om`: with autosave on, the unsaved-changes guard arms only after a failed save. */
export function reportedDirty(state: SaveState, autoSave: boolean): boolean {
	return editorDirty(state) && (!autoSave || state.error !== null);
}

const BANNER_COPY: Record<SaveError["kind"], {copy: string; retry: string | null}> = {
	writeFailed: {copy: "Couldn’t save this file.", retry: "Try again"},
	conflict: {copy: "This file changed on disk since you started editing.", retry: "Override"},
	missing: {copy: "This file was deleted on disk since you started editing.", retry: "Save anyway"},
	denied: {
		copy: "This file can’t be saved. Its path is outside the working directory, or this is a remote session.",
		retry: null,
	},
};

export function bannerCopy(error: SaveError): string {
	return BANNER_COPY[error.kind].copy;
}

export function retryLabel(error: SaveError): string | null {
	return BANNER_COPY[error.kind].retry;
}

export interface AutoSave {
	/** Restart the idle timer. */
	change(): void;
	/** Cancel the idle timer and save now. */
	flush(reason: SaveReason): void;
	/** Cancel the timer; `flush` saves with `"unmount"`. */
	dispose(flush: boolean): void;
}

export function createAutoSave({
	delayMs = AUTO_SAVE_DELAY_MS,
	save,
}: {
	delayMs?: number;
	save: (reason: SaveReason) => void;
}): AutoSave {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};
	const flush = (reason: SaveReason) => {
		cancel();
		save(reason);
	};
	return {
		change() {
			cancel();
			timer = setTimeout(() => {
				timer = null;
				save("idle");
			}, delayMs);
		},
		flush,
		dispose(flushUnmount) {
			if (flushUnmount) flush("unmount");
			else cancel();
		},
	};
}

export interface SourceSaver {
	change(text: string): void;
	flush(reason: SaveReason): void;
	dispose(flush: boolean): void;
}

/**
 * Autosave plus upstream `gS`'s write queue: a flush while a write is in flight keeps only the
 * latest text and writes it once that write settles, and a text equal to the disk contents is
 * never written. A rejected write drops the queue (upstream stops saving while an error shows).
 */
export function createSourceSaver({
	delayMs = AUTO_SAVE_DELAY_MS,
	write,
	diskText,
}: {
	delayMs?: number;
	write: (text: string, reason: SaveReason) => Promise<void>;
	diskText: () => string;
}): SourceSaver {
	let latest: string | null = null;
	let inFlight = false;
	let queued: {text: string; reason: SaveReason} | null = null;

	const start = (text: string, reason: SaveReason) => {
		if (text === diskText()) return;
		inFlight = true;
		write(text, reason).then(
			() => {
				inFlight = false;
				const next = queued;
				queued = null;
				if (next) start(next.text, next.reason);
			},
			() => {
				inFlight = false;
				queued = null;
			},
		);
	};

	const auto = createAutoSave({
		delayMs,
		save: (reason) => {
			if (latest === null) return;
			if (inFlight) queued = {text: latest, reason};
			else start(latest, reason);
		},
	});

	return {
		change(text) {
			latest = text;
			auto.change();
		},
		flush: (reason) => {
			auto.flush(reason);
		},
		dispose: (flush) => {
			auto.dispose(flush);
		},
	};
}
