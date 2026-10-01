// The browser reconnects an EventSource by itself after a dropped connection, but a non-200 response (a 503 while
// the dev server restarts) fails the stream for good: readyState goes to CLOSED and no event ever arrives again.

/** EventSource.CLOSED, spelled out because test doubles don't define the static constants. */
const CLOSED = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export function sseReconnectDelay(attempt: number): number {
	return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

interface ReconnectingEventSourceOptions {
	/** Adds the event listeners to each stream, including every reopened one. */
	attach(es: EventSource): void;
	/** Runs when a stream opens after any error, so the caller can catch up on events missed during the gap. */
	onReconnected(): void;
}

/** Opens an EventSource that reopens itself with backoff whenever the server refuses it. Returns a close function. */
export function openReconnectingEventSource(url: string, options: ReconnectingEventSourceOptions): () => void {
	let es: EventSource;
	let attempt = 0;
	let hadError = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const connect = (): void => {
		const current = new EventSource(url);
		es = current;
		options.attach(current);
		current.onerror = () => {
			hadError = true;
			if (current.readyState !== CLOSED) return;
			current.close();
			timer = setTimeout(connect, sseReconnectDelay(attempt));
			attempt++;
		};
		current.addEventListener("open", () => {
			attempt = 0;
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
