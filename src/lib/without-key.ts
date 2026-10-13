/** A shallow copy of `record` without `key`, for removing entries without mutating or dynamically deleting. */
export function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
	return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}
