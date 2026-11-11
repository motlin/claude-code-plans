import {useMemo, useSyncExternalStore} from "react";

import {isSyntheticDiffRow} from "../components/changes/diff-file-menu-gate";
import {sha256Hex} from "./sha256";

/*
 * claude.ai/code's Changes "Viewed" marks (c44d00c7f; 2026-11-05 build symbols in brackets): the patch
 * fingerprint `fs` [uu] and markability `ss` [au], the persisted zustand store `ks` [Du] under
 * `localStorage["diff-file-marks"]` with its hydrate filter `Ds` [Tu] and prune `Os` [Eu], set `Ps`, status
 * `Fs`, the patch-change unmark `Is`, and the `zs` hook. Marks persist per browser, like `diff-annotations`.
 */

/** Which comparison a mark belongs to: upstream `{sessionId, repo, diff: JSON.stringify([scopeKey, base, head])}`. */
export interface DiffMarkScope {
	sessionId: string;
	repo: string;
	diff: string;
}

interface MarkRecord {
	repo: string;
	filePath: string;
	diff: string;
	fingerprint: string;
	at: number;
}

type Marks = Readonly<Record<string, readonly MarkRecord[]>>;

export type DiffFileMarkStatus = "marked" | "stale" | "none";

/** A file's mark as the header, menu and tree read it (upstream `zs`'s result). */
export interface DiffFileMark {
	status: DiffFileMarkStatus;
	canMark: boolean;
	setMarked(marked: boolean): void;
}

const STORAGE_KEY = "diff-file-marks";
const MAX_SESSIONS = 50;
const MAX_MARKS = 2000;
/** 45 days. */
const MAX_AGE_MS = 3888e6;
const FINGERPRINT_CACHE_BYTES = 8_388_608;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const FULL_ID = "(?:[0-9a-f]{40}|[0-9a-f]{64})";
const FULL_INDEX_LINE = new RegExp(`^index (${FULL_ID})\\.\\.(${FULL_ID})(?![0-9a-f])`);
const MODE_OR_RENAME_LINE = /^(?:old mode|new mode|rename from|rename to) /;
const CREATED_OR_DELETED_MODE = /^(new file|deleted file) mode (\d{3})\d{3}$/;
const HAS_HUNK = /(?:^|\n)@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const HAS_FULL_INDEX = new RegExp(`(?:^|\\n)index ${FULL_ID}\\.\\.${FULL_ID}(?![0-9a-f])`);
const HAS_INDEX = /(?:^|\n)index /;
const HAS_MODE_OR_RENAME = /(?:^|\n)(?:old mode|new mode|rename from|rename to) /;

/** Upstream `ss`: one file's patch whose later changes a fingerprint would detect. */
export function canMarkPatch(patch: string | null | undefined): patch is string {
	if (patch === null || patch === undefined || patch === "" || patch.includes("\ndiff --git ")) return false;
	return (
		HAS_HUNK.test(patch) || HAS_FULL_INDEX.test(patch) || (HAS_MODE_OR_RENAME.test(patch) && !HAS_INDEX.test(patch))
	);
}

const fingerprintCache = new Map<string, string>();
let fingerprintCacheBytes = 0;

/** Upstream `ds`: an LRU keyed by the raw patch, capped at 8 MiB of key length; a larger patch is never cached. */
function remember(patch: string, fingerprint: string): string {
	if (patch.length > FINGERPRINT_CACHE_BYTES) return fingerprint;
	fingerprintCache.set(patch, fingerprint);
	fingerprintCacheBytes += patch.length;
	for (const key of fingerprintCache.keys()) {
		if (fingerprintCacheBytes <= FINGERPRINT_CACHE_BYTES) break;
		fingerprintCache.delete(key);
		fingerprintCacheBytes -= key.length;
	}
	return fingerprint;
}

/**
 * Upstream `fs`: the kept header lines (new/deleted file mode digits, mode and rename lines) plus the hunks with
 * each `@@` header reduced to its ranges, hashed; a hunkless patch uses its full index ids when it has them.
 */
export function patchFingerprint(patch: string | null | undefined): string | null {
	if (!canMarkPatch(patch)) return null;
	const cached = fingerprintCache.get(patch);
	if (cached !== undefined) return cached;
	const lines = patch.split("\n");
	if (lines.at(-1) === "") lines.pop();
	const firstHunk = lines.findIndex((line) => HUNK_HEADER.test(line));
	const header = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
	const kept = header.flatMap((line) => {
		const mode = CREATED_OR_DELETED_MODE.exec(line);
		if (mode) return [`${mode[1] ?? ""} ${mode[2] ?? ""}`];
		return MODE_OR_RENAME_LINE.test(line) ? [line] : [];
	});
	if (firstHunk === -1) {
		const ids = header.map((line) => FULL_INDEX_LINE.exec(line)).find(Boolean);
		return remember(
			patch,
			ids ? `ids:${ids[1] ?? ""}..${ids[2] ?? ""}\n${kept.join("\n")}` : `sha256:${sha256Hex(kept.join("\n"))}`,
		);
	}
	const hunks = lines.slice(firstHunk).map((line) => {
		const match = HUNK_HEADER.exec(line);
		return match ? `@@ ${match[1] ?? ""},${match[2] ?? 1} ${match[3] ?? ""},${match[4] ?? 1}` : line;
	});
	return remember(patch, `sha256:${sha256Hex([...kept, ...hunks].join("\n"))}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Upstream `Ds`: keeps well-formed records no newer than now and at most 45 days old. */
function readMarkRecords(value: unknown, now: number): Record<string, MarkRecord[]> {
	const readOne = (item: unknown): MarkRecord[] => {
		if (!isRecord(item)) return [];
		const {repo, filePath, diff, fingerprint, at} = item;
		return typeof repo === "string" &&
			typeof filePath === "string" &&
			typeof diff === "string" &&
			typeof fingerprint === "string" &&
			typeof at === "number" &&
			at <= now &&
			now - at <= MAX_AGE_MS
			? [{repo, filePath, diff, fingerprint, at}]
			: [];
	};
	const entries = isRecord(value) ? Object.entries(value) : [];
	return Object.fromEntries(
		entries
			.map(([sessionId, list]): [string, MarkRecord[]] => [
				sessionId,
				Array.isArray(list) ? list.flatMap(readOne) : [],
			])
			.filter(([, list]) => list.length > 0),
	);
}

/** Upstream `Os`: past 50 sessions or 2000 marks, keep marks from the 2000th-newest on, then the 50 freshest sessions. */
function prune(marks: Marks): Marks {
	const entries = Object.entries(marks);
	const times = entries.flatMap(([, list]) => list.map((record) => record.at));
	if (entries.length <= MAX_SESSIONS && times.length <= MAX_MARKS) return marks;
	const cutoff = times.toSorted((a, b) => b - a)[MAX_MARKS - 1] ?? 0;
	const newest = (list: readonly MarkRecord[]) => list.reduce((latest, record) => Math.max(latest, record.at), 0);
	return Object.fromEntries(
		entries
			.map(([sessionId, list]): [string, readonly MarkRecord[]] => [
				sessionId,
				list.filter((record) => record.at >= cutoff),
			])
			.filter(([, list]) => list.length > 0)
			.toSorted((a, b) => newest(b[1]) - newest(a[1]))
			.slice(0, MAX_SESSIONS),
	);
}

const NO_MARKS: Marks = {};
const NO_RECORDS: readonly MarkRecord[] = [];

/** The last raw value read and its parsed marks; storage stays the source of truth, so other tabs' writes show up. */
let cache: {raw: string | null; marks: Marks} = {raw: null, marks: NO_MARKS};
/** Where marks live when localStorage is unavailable. */
let memoryRaw: string | null = null;

function readRaw(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return memoryRaw;
	}
}

/** Upstream's persist `merge`: hydrate through `Ds` then `Os`. */
function readMarks(): Marks {
	const raw = readRaw();
	if (raw === cache.raw) return cache.marks;
	let marks: Marks = NO_MARKS;
	if (raw !== null) {
		try {
			const parsed: unknown = JSON.parse(raw);
			const state = isRecord(parsed) ? parsed["state"] : undefined;
			marks = prune(readMarkRecords(isRecord(state) ? state["marks"] : undefined, Date.now()));
		} catch {
			// A corrupt value reads as no marks.
		}
	}
	cache = {raw, marks};
	return marks;
}

const storeListeners = new Set<() => void>();

function writeMarks(marks: Marks): void {
	const raw = JSON.stringify({state: {marks}, version: 0});
	memoryRaw = raw;
	try {
		localStorage.setItem(STORAGE_KEY, raw);
	} catch {
		// Storage full or blocked: marks stay in memory for this page.
	}
	cache = {raw, marks};
	for (const listener of storeListeners) listener();
}

const recordsByFile = new WeakMap<readonly MarkRecord[], Map<string, readonly MarkRecord[]>>();

/** Upstream `Es`: one file's records in this repo, grouped once per session list so the result is stable. */
function fileRecords(marks: Marks, scope: DiffMarkScope, path: string): readonly MarkRecord[] {
	const list = Object.hasOwn(marks, scope.sessionId) ? (marks[scope.sessionId] ?? NO_RECORDS) : NO_RECORDS;
	let grouped = recordsByFile.get(list);
	if (grouped === undefined) {
		const built = new Map<string, MarkRecord[]>();
		for (const record of list) {
			const key = JSON.stringify([record.repo, record.filePath]);
			built.set(key, [...(built.get(key) ?? []), record]);
		}
		grouped = built;
		recordsByFile.set(list, grouped);
	}
	return grouped.get(JSON.stringify([scope.repo, path])) ?? NO_RECORDS;
}

/** Upstream `Fs`: marked when a record matches this patch's fingerprint, stale when only this diff has one. */
function statusOf(records: readonly MarkRecord[], diff: string, patch: string | null | undefined): DiffFileMarkStatus {
	const fingerprint = records.length === 0 ? null : patchFingerprint(patch);
	if (fingerprint === null) return "none";
	if (records.some((record) => record.fingerprint === fingerprint)) return "marked";
	return records.some((record) => record.diff === diff) ? "stale" : "none";
}

export function fileMarkStatus(
	scope: DiffMarkScope,
	path: string,
	patch: string | null | undefined,
): DiffFileMarkStatus {
	return statusOf(fileRecords(readMarks(), scope, path), scope.diff, patch);
}

/**
 * One patch change's announcements to one listener (upstream `Is`'s per-context object): the first file to hold its
 * header in place sets `held`, so a burst of expanding files doesn't jump the scroll.
 */
export interface MarkBurst {
	held: boolean;
}

type MarkChangeListener = (scope: DiffMarkScope, path: string, marked: boolean, burst?: MarkBurst) => void;

const markListeners = new Set<MarkChangeListener>();

/**
 * Upstream `js` [Fu]: hears marks set or cleared, and marked files whose patch changed (with `marked` false and the
 * change's shared burst).
 */
export function subscribeMarkChanges(listener: MarkChangeListener): () => void {
	markListeners.add(listener);
	return () => {
		markListeners.delete(listener);
	};
}

/**
 * Upstream `zs`'s setMarked plus `Ps`: drops this file's records for this diff or this fingerprint, then appends
 * the new mark; records for other diffs with other fingerprints stay, which is how a mark later reads stale.
 * Marking a patch with no fingerprint does nothing.
 */
export function setFileMarked(
	scope: DiffMarkScope,
	path: string,
	patch: string | null | undefined,
	marked: boolean,
): void {
	const fingerprint = patchFingerprint(patch);
	if (marked && fingerprint === null) return;
	const marks = readMarks();
	const list = Object.hasOwn(marks, scope.sessionId) ? (marks[scope.sessionId] ?? NO_RECORDS) : NO_RECORDS;
	const isThisFile = (record: MarkRecord) => record.repo === scope.repo && record.filePath === path;
	const sameFingerprint = (record: MarkRecord) => fingerprint !== null && record.fingerprint === fingerprint;
	const next = list.filter(
		(record) => !isThisFile(record) || (record.diff !== scope.diff && !sameFingerprint(record)),
	);
	if (marked && fingerprint !== null) {
		next.push({repo: scope.repo, filePath: path, diff: scope.diff, fingerprint, at: Date.now()});
	}
	const {[scope.sessionId]: _previous, ...others} = marks;
	writeMarks(prune(next.length > 0 ? {...others, [scope.sessionId]: next.slice(-MAX_MARKS)} : others));
	if (marked || list.some((record) => isThisFile(record) && sameFingerprint(record))) {
		for (const listener of markListeners) listener(scope, path, marked);
	}
}

/** Upstream `Is`: a file marked under its old patch but not its new one is announced unmarked, so it expands again. */
export function notifyPatchChanges(
	scope: DiffMarkScope,
	before: ReadonlyMap<string, string | null>,
	after: ReadonlyMap<string, string | null>,
): void {
	const marks = readMarks();
	const bursts = new Map<MarkChangeListener, MarkBurst>();
	for (const [path, patch] of after) {
		const previous = before.get(path);
		if (previous === undefined || previous === null || patch === previous) continue;
		const records = fileRecords(marks, scope, path);
		if (statusOf(records, scope.diff, previous) === "marked" && statusOf(records, scope.diff, patch) !== "marked") {
			for (const listener of markListeners) {
				const burst = bursts.get(listener) ?? {held: false};
				bursts.set(listener, burst);
				listener(scope, path, false, burst);
			}
		}
	}
}

function onStorage(event: StorageEvent): void {
	if (event.key !== null && event.key !== STORAGE_KEY) return;
	for (const listener of storeListeners) listener();
}

function subscribe(listener: () => void): () => void {
	if (storeListeners.size === 0) window.addEventListener("storage", onStorage);
	storeListeners.add(listener);
	return () => {
		storeListeners.delete(listener);
		if (storeListeners.size === 0) window.removeEventListener("storage", onStorage);
	};
}

/** Upstream `zs`: undefined without a scope or for a synthetic row, else the file's live mark. */
export function useFileMark(
	scope: DiffMarkScope | undefined,
	path: string,
	patch: string | null | undefined,
): DiffFileMark | undefined {
	const active = scope !== undefined && !isSyntheticDiffRow(path) ? scope : undefined;
	const records = useSyncExternalStore(
		subscribe,
		() => (active === undefined ? NO_RECORDS : fileRecords(readMarks(), active, path)),
		() => NO_RECORDS,
	);
	return useMemo(
		() =>
			active && {
				status: statusOf(records, active.diff, patch),
				canMark: canMarkPatch(patch),
				setMarked: (marked: boolean) => {
					setFileMarked(active, path, patch, marked);
				},
			},
		[active, path, patch, records],
	);
}
