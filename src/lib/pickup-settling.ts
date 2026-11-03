import {useEffect, useState, useSyncExternalStore} from "react";

/** Upstream `KT`: how long a picked-up row stays "read" before it settles. */
const PICKUP_READ_MS = 1400;
/** Upstream `qT`: how long the settling time fade lasts. */
const PICKUP_SETTLING_MS = 400;

/*
 * Upstream's waiting row turns into the transcript row in place: `unread → read` (1400ms) →
 * `settling` (400ms, the time fades in) → rest. Locally the transcript row is a fresh mount, so
 * pickups are remembered by prompt text and the new row reads its phase from here.
 */
const pickups = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Claude read the waiting prompt `text` just now. */
export function recordPickup(text: string): void {
	pickups.set(text, Date.now());
	emit();
}

/** Forgets every pickup; for tests. */
export function clearPickups(): void {
	pickups.clear();
	emit();
}

/** True during upstream's `settling` phase for the transcript row that replaced the waiting `text`. */
export function usePickupSettling(text: string): boolean {
	const pickedAt = useSyncExternalStore(
		subscribe,
		() => pickups.get(text),
		() => undefined,
	);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (pickedAt === undefined) return undefined;
		const settleAt = pickedAt + PICKUP_READ_MS;
		const restAt = settleAt + PICKUP_SETTLING_MS;
		const current = Date.now();
		setNow(current);
		if (current >= restAt) return undefined;
		const timers = [settleAt, restAt]
			.filter((at) => at > current)
			.map((at) =>
				setTimeout(() => {
					setNow(Date.now());
				}, at - current),
			);
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	}, [pickedAt]);
	if (pickedAt === undefined) return false;
	const elapsed = now - pickedAt;
	return elapsed >= PICKUP_READ_MS && elapsed < PICKUP_READ_MS + PICKUP_SETTLING_MS;
}
