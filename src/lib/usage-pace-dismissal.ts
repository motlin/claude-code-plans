import {useSyncExternalStore} from "react";
import {z} from "zod";
import type {UsageBandDismissal, UsageBandDismissals, UsageBandWindow} from "./usage";

/**
 * Per-browser dismissals of the composer's usage band, one per window as upstream's `Kt` store
 * keeps them: the reset and threshold the band was dismissed at.
 */
const USAGE_BAND_STORAGE_KEY = "ccp-usage-band-dismissed";

const DismissalSchema = z.object({validUntil: z.number(), threshold: z.number()});
const DismissalsSchema = z.object({"5h": DismissalSchema.optional(), "7d": DismissalSchema.optional()});

const EMPTY: UsageBandDismissals = {};

const listeners = new Set<() => void>();
/** Used when storage is unreadable, so a dismissal still holds for this page load. */
let memoryDismissals: UsageBandDismissals = EMPTY;
/** The last parse, keyed by its raw string, so the external-store snapshot stays referentially stable. */
let cached: {raw: string | null; value: UsageBandDismissals} = {raw: null, value: EMPTY};

function parse(raw: string): UsageBandDismissals {
	try {
		const result = DismissalsSchema.safeParse(JSON.parse(raw));
		if (!result.success) return EMPTY;
		const value: UsageBandDismissals = {};
		if (result.data["5h"] !== undefined) value["5h"] = result.data["5h"];
		if (result.data["7d"] !== undefined) value["7d"] = result.data["7d"];
		return value;
	} catch {
		return EMPTY;
	}
}

export function readUsageBandDismissals(): UsageBandDismissals {
	let raw: string | null;
	try {
		raw = localStorage.getItem(USAGE_BAND_STORAGE_KEY);
	} catch {
		return memoryDismissals;
	}
	if (raw === null) return EMPTY;
	if (cached.raw !== raw) cached = {raw, value: parse(raw)};
	return cached.value;
}

export function writeUsageBandDismissal(window: UsageBandWindow, dismissal: UsageBandDismissal): void {
	const next = {...readUsageBandDismissals(), [window]: dismissal};
	memoryDismissals = next;
	try {
		localStorage.setItem(USAGE_BAND_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Storage unavailable: the in-memory value covers this page load.
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === USAGE_BAND_STORAGE_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

export function useUsageBandDismissals(): UsageBandDismissals {
	return useSyncExternalStore(subscribe, readUsageBandDismissals, () => EMPTY);
}
