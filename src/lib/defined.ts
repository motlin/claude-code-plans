/**
 * Narrows a value the surrounding logic guarantees is present (an in-bounds index, a required
 * regex group, a key just inserted) and throws `message` if that invariant is ever broken,
 * instead of a non-null assertion that would let `undefined` flow on silently.
 */
export function defined<T>(value: T, message: string): NonNullable<T> {
	if (value === undefined || value === null) throw new Error(message);
	return value;
}
