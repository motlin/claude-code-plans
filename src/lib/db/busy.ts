/** True for SQLITE_BUSY and its extended codes, including when drizzle wraps the SqliteError as the cause. */
export function isBusyError(err: unknown): boolean {
	for (let current = err; current instanceof Error; current = current.cause) {
		const code = (current as {code?: unknown}).code;
		if (typeof code === "string" && code.startsWith("SQLITE_BUSY")) return true;
	}
	return false;
}

// About 16 s in all, well past any single transaction another server instance holds.
const RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000, 4000, 8000];

/**
 * Runs `step` again after an asynchronous pause each time it fails with SQLITE_BUSY. better-sqlite3 waits for a lock
 * by sleeping the thread, so the connection's busy timeout is kept short and longer waits happen here, where the
 * event loop keeps serving requests. `step` must be safe to repeat from the start.
 */
export async function retryWhileBusy<T>(step: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await step();
		} catch (err) {
			const delayMs = RETRY_DELAYS_MS[attempt];
			if (delayMs === undefined || !isBusyError(err) || signal?.aborted) throw err;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}
