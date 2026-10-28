/** React's thenable tracking fields: a promise tagged `fulfilled` makes `use()` return its value without suspending. */
export type TrackedPromise<T> = Promise<T> & {status?: "fulfilled"; value?: T};

/**
 * Wraps a cached download so it tags itself fulfilled when it settles. A lazy boundary can then call `use()` on it
 * every render — suspending only while it loads, returning synchronously after — instead of skipping `use()` once the
 * module is in hand, which React flags as conditional use() on the retry after a suspension.
 */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one tagged promise, which use() needs to be stable
export function trackFulfillment<T>(promise: Promise<T>): TrackedPromise<T> {
	const tracked: TrackedPromise<T> = promise.then((value) => {
		// Tagged even when a warm-up finished the download, so every later use() is synchronous.
		tracked.status = "fulfilled";
		tracked.value = value;
		return value;
	});
	return tracked;
}
