// The browser reconnects an EventSource by itself after a dropped connection, but a non-200 response (a 503 while
// the dev server restarts) fails the stream for good: readyState goes to CLOSED and no event ever arrives again.

/** EventSource.CLOSED, spelled out because test doubles don't define the static constants. */
const CLOSED = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
/** After this many wakes without a stream opening, only `online` wakes a pending reopen, as upstream's `vC` does. */
const VISIBLE_WAKE_LIMIT = 2;

/** The stream's state as the UI shows it; the stream never gives up, so there is no "disconnected". */
export type StreamStatus = "connecting" | "connected" | "reconnecting";

/** Doubles from one second to thirty, jittered by ×[0.75, 1.25] so separate browsers don't retry in lockstep. */
export function sseReconnectDelay(attempt: number, random: () => number = Math.random): number {
	return Math.round(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS) * (0.75 + random() * 0.5));
}

export interface ReconnectingEventSourceOptions {
	/** Adds the event listeners to each stream, including every reopened one. */
	attach(es: EventSource): void;
	/** Runs when a stream opens after any error, so the caller can catch up on events missed during the gap. */
	onReconnected(): void;
	/** The stream starts after a gap (a tab taking over the shared stream), so its first open catches up too. */
	resumeAfterGap?: boolean;
	/** Runs whenever the stream's status changes. */
	onStatus?(status: StreamStatus): void;
	/** The backoff jitter's source, injectable for tests. */
	random?: () => number;
}

/** Opens an EventSource that reopens itself with backoff whenever the server refuses it. Returns a close function. */
export function openReconnectingEventSource(url: string, options: ReconnectingEventSourceOptions): () => void {
	let es: EventSource;
	let attempt = 0;
	let hadError = options.resumeAfterGap === true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let status: StreamStatus | undefined;
	let wakes = 0;
	let removeWakeListeners: (() => void) | undefined;

	const setStatus = (next: StreamStatus): void => {
		if (next === status) return;
		status = next;
		options.onStatus?.(next);
	};

	const stopWaiting = (): void => {
		removeWakeListeners?.();
		removeWakeListeners = undefined;
	};

	const reconnectSoon = (): void => {
		stopWaiting();
		clearTimeout(timer);
		wakes++;
		timer = setTimeout(connect, sseReconnectDelay(0, options.random));
	};

	// While a reopen waits out its backoff, coming back online or to the page reconnects in about a second instead.
	const waitForWake = (): void => {
		const onVisibilityChange = (): void => {
			if (document.visibilityState === "visible") reconnectSoon();
		};
		window.addEventListener("online", reconnectSoon);
		const onlineOnly = wakes >= VISIBLE_WAKE_LIMIT;
		if (!onlineOnly) document.addEventListener("visibilitychange", onVisibilityChange);
		removeWakeListeners = () => {
			window.removeEventListener("online", reconnectSoon);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	};

	const connect = (): void => {
		stopWaiting();
		setStatus("connecting");
		const current = new EventSource(url);
		es = current;
		options.attach(current);
		current.onerror = () => {
			hadError = true;
			setStatus("reconnecting");
			if (current.readyState !== CLOSED) return;
			current.close();
			timer = setTimeout(connect, sseReconnectDelay(attempt, options.random));
			attempt++;
			waitForWake();
		};
		current.addEventListener("open", () => {
			attempt = 0;
			wakes = 0;
			setStatus("connected");
			if (hadError) {
				hadError = false;
				options.onReconnected();
			}
		});
	};

	connect();
	return () => {
		clearTimeout(timer);
		stopWaiting();
		es.close();
	};
}
