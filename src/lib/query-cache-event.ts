import type {QueryCacheNotifyEvent, QueryKey} from "@tanstack/react-query";

/** The key of the query a cache event is about; the event types it `any`, so this is the typed way to read it. */
export function eventQueryKey(event: QueryCacheNotifyEvent): QueryKey {
	const key: unknown = event.query.queryKey;
	return Array.isArray(key) ? key : [];
}
