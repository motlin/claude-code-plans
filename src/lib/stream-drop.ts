import type {StreamStatus} from "./reconnecting-event-source";

/** How a dropped `/api/events` stream is getting back: null while connected, or before it ever dropped. */
export type StreamDrop = Exclude<StreamStatus, "connected"> | null;

/**
 * Follows a status change. A drop lasts until the stream connects again, and until then a reopen in flight is
 * "connecting"; the page's first connect isn't a drop (the server-rendered page is already populated).
 */
export function nextStreamDrop(current: StreamDrop, status: StreamStatus): StreamDrop {
	if (status === "connected") return null;
	if (status === "reconnecting") return "reconnecting";
	return current === null ? null : "connecting";
}

/**
 * Upstream's Environment row hint for the session transport, applied to the local stream: "Reconnecting" while it
 * is down and "Connecting" while a reopen is in flight. No "Disconnected": the local stream never gives up.
 */
export function streamDropHint(drop: Exclude<StreamDrop, null>): string {
	return drop === "reconnecting" ? "Reconnecting" : "Connecting";
}
