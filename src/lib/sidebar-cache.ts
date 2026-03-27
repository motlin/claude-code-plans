interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const TTL_MS = 5_000;

export function getCached<T>(key: string): T | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (Date.now() - entry.timestamp > TTL_MS) {
		cache.delete(key);
		return undefined;
	}
	return entry.data as T;
}

export function setCache<T>(key: string, data: T): void {
	cache.set(key, {data, timestamp: Date.now()});
}

export function invalidateCache(key: string): void {
	cache.delete(key);
}
