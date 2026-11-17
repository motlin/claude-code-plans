import {useCallback, useSyncExternalStore} from "react";

/** Upstream `D2`: the `data-row-key` of the row holding focus, if any. */
function readFocusedRowKey(): string | null
{
	const row = document.activeElement?.closest("[data-row-key]");
	return row instanceof HTMLElement ? (row.dataset["rowKey"] ?? null) : null;
}

/** Upstream `S_`: the focused key when it is one of the section's keys. */
function ownKey(keys: ReadonlySet<string>, key: string | null): string | null
{
	return key !== null && keys.has(key) ? key : null;
}

interface Subscriber
{
	keys: ReadonlySet<string>;
	notify: () => void;
	last: string | null;
}

const subscribers = new Set<Subscriber>();
let current: string | null = null;
let listening = false;

/** Upstream `_2`: re-reads focus while listening (a removed row fires no focusout), updating each section's last key. */
function refreshCurrent(): string | null
{
	const key = readFocusedRowKey();
	if (key !== current)
	{
		current = key;
		for (const subscriber of subscribers) subscriber.last = ownKey(subscriber.keys, key);
	}
	return current;
}

/** Upstream `zX`: one shared capture-phase focusin/focusout handler notifying only the sections whose key changed. */
function onFocusChange(): void
{
	const key = readFocusedRowKey();
	if (key === current) return;
	current = key;
	for (const subscriber of subscribers)
	{
		const next = ownKey(subscriber.keys, key);
		if (next === subscriber.last) continue;
		subscriber.last = next;
		subscriber.notify();
	}
}

/** Upstream `fJ`: reference-counts the document listeners across every subscribed section. */
function subscribe(keys: ReadonlySet<string>, notify: () => void): () => void
{
	if (!listening)
	{
		listening = true;
		current = readFocusedRowKey();
		document.addEventListener("focusin", onFocusChange, true);
		document.addEventListener("focusout", onFocusChange, true);
	}
	const subscriber: Subscriber =
	{
		keys,
		notify,
		last: ownKey(keys, refreshCurrent()),
	};
	subscribers.add(subscriber);
	return () =>
	{
		subscribers.delete(subscriber);
		if (subscribers.size > 0 || !listening) return;
		listening = false;
		document.removeEventListener("focusin", onFocusChange, true);
		document.removeEventListener("focusout", onFocusChange, true);
	};
}

function subscribeNever(): () => void
{
	return () =>
	{
	};
}

function readNull(): null
{
	return null;
}

/**
 * Upstream `AJ`: the focused row's key when it belongs to this section's `keys`, else null. A null `keys` (a
 * section that hides nothing) neither subscribes nor reads focus.
 */
export function useFocusedSectionRowKey(keys: ReadonlySet<string> | null): string | null
{
	const subscribeKeys = useCallback(
		(notify: () => void) => (keys === null ? subscribeNever() : subscribe(keys, notify)),
		[keys],
	);
	const read = useCallback(
		() => (keys === null ? null : ownKey(keys, listening ? refreshCurrent() : readFocusedRowKey())),
		[keys],
	);
	return useSyncExternalStore(subscribeKeys, read, readNull);
}
