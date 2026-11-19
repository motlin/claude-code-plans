import {useSyncExternalStore} from "react";

/** A ⌘K artifact row's screenshot: upstream's `thumb`, a dark src with its light `fallbackSrc`. */
export interface PaletteThumb
{
	src: string;
	fallbackSrc?: string;
}

// Upstream's module-level stores: srcs that loaded (`q`) and srcs that failed (`Et`, replaced on change so
// subscribers re-render). Upstream's per-thumb `onError` report has no local caller.
const loadedSrcs = new Set<string>();
let failedSrcs: ReadonlySet<string> = new Set();
const failedListeners = new Set<() => void>();

/** Upstream's `K`: a src without its cache-busting query. */
export function thumbKey(src: string): string
{
	return src.split("?", 1)[0] ?? src;
}

function subscribeFailed(listener: () => void): () => void
{
	failedListeners.add(listener);
	return () =>
	{
		failedListeners.delete(listener);
	};
}

function readFailed(): ReadonlySet<string>
{
	return failedSrcs;
}

export function markThumbFailed(src: string): void
{
	failedSrcs = new Set(failedSrcs).add(src);
	for (const listener of failedListeners) listener();
}

export function useFailedThumbSrcs(): ReadonlySet<string>
{
	return useSyncExternalStore(subscribeFailed, readFailed, readFailed);
}

/** Upstream's `kt`: every src the thumb could show has failed. */
export function thumbFailed(thumb: PaletteThumb, failed: ReadonlySet<string>): boolean
{
	return failed.has(thumb.src) && (thumb.fallbackSrc === undefined || failed.has(thumb.fallbackSrc));
}

/** Records a src that loaded, so a later card shows it at once. */
export function recordThumbLoaded(src: string): void
{
	loadedSrcs.add(src);
}

/** Upstream's `Nt`: one of the thumb's srcs has loaded before. */
export function isThumbLoaded(thumb: PaletteThumb): boolean
{
	return loadedSrcs.has(thumb.src) || (thumb.fallbackSrc !== undefined && loadedSrcs.has(thumb.fallbackSrc));
}

/** Upstream's `jt`/`Mt`: the thumb, until every src it could show has failed for this page's life. */
export function useUsableThumb(thumb: PaletteThumb | undefined): PaletteThumb | undefined
{
	const failed = useFailedThumbSrcs();
	return thumb === undefined || thumbFailed(thumb, failed) ? undefined : thumb;
}

/** Upstream's `X`: the dark src, or the light one once the dark one failed. */
export function preferredThumbSrc(thumb: PaletteThumb, failed: ReadonlySet<string>): string
{
	return failed.has(thumb.src) && thumb.fallbackSrc !== undefined ? thumb.fallbackSrc : thumb.src;
}

/** Forget every loaded and failed src, as a reload would. */
export function resetThumbStore(): void
{
	loadedSrcs.clear();
	failedSrcs = new Set();
	for (const listener of failedListeners) listener();
}
