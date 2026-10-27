// The browser reconnects an EventSource by itself after a dropped connection, but a non-200 response (a 503 while
// the dev server restarts) fails the stream for good: readyState goes to CLOSED and no event ever arrives again.

/** EventSource.CLOSED, spelled out because test doubles don't define the static constants. */
const CLOSED = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

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

	const setStatus = (next: StreamStatus): void => {
		if (next === status) return;
		status = next;
		options.onStatus?.(next);
	};

	const connect = (): void => {
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
		};
		current.addEventListener("open", () => {
			attempt = 0;
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
		es.close();
	};
}
