import {useSyncExternalStore} from "react";
import {z} from "zod";

/**
 * Upstream claude.ai/code's per-browser "Mark as completed" acks (`NV`, a zustand store persisted to
 * localStorage as `epitaxy-awaiting-ack-v1`): session id → the `updated_at` (here the transcript mtime) it was
 * acked at. An ack covers the session while it is at or after its mtime, so new activity voids it on its own;
 * nothing else clears it.
 */
export const AWAITING_ACK_STORAGE_KEY = "epitaxy-awaiting-ack-v1";

/** Zustand persist's `{state, version}` envelope; lenient at runtime, checked strictly in the tests. */
export const AwaitingAckStorageSchema = z.object({
	state: z.object({ackedAt: z.record(z.string(), z.number())}),
	version: z.number(),
});

const listeners = new Set<() => void>();
const acks = new Map<string, number>(load());
let version = 0;

function load(): [string, number][] {
	try {
		const raw = localStorage.getItem(AWAITING_ACK_STORAGE_KEY);
		if (raw === null) return [];
		const result = AwaitingAckStorageSchema.safeParse(JSON.parse(raw));
		return result.success ? Object.entries(result.data.state.ackedAt) : [];
	} catch {
		return [];
	}
}

function save(): void {
	try {
		localStorage.setItem(
			AWAITING_ACK_STORAGE_KEY,
			JSON.stringify({state: {ackedAt: Object.fromEntries(acks)}, version: 0}),
		);
	} catch {
		// Storage can be denied or full; the ack still holds in memory for this tab.
	}
}

function emitChange(): void {
	version += 1;
	save();
	for (const listener of listeners) listener();
}

/** Ack a session at `ms`; a no-op when that is already its ack. */
export function ack(sessionId: string, ms: number): void {
	if (acks.get(sessionId) === ms) return;
	acks.set(sessionId, ms);
	emitChange();
}

export function clear(sessionId: string): void {
	if (acks.delete(sessionId)) emitChange();
}

export function ackedAt(sessionId: string): number | undefined {
	return acks.get(sessionId);
}

/** Upstream `hh`: the ack is at or after the session's mtime. */
export function isAcked(sessionId: string, mtimeIso: string): boolean {
	const acked = acks.get(sessionId);
	return acked !== undefined && acked >= Date.parse(mtimeIso);
}

export function subscribeAwaitingAck(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** A counter that changes with every ack or clear, for memo deps. */
export function useAwaitingAckVersion(): number {
	return useSyncExternalStore(
		subscribeAwaitingAck,
		() => version,
		() => 0,
	);
}

export const __awaitingAckTesting = {
	reset(): void {
		acks.clear();
		emitChange();
	},
};
