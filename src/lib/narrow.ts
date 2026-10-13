/** Type guards that narrow unvalidated values (parsed JSON, caught errors, DOM targets) without type assertions. */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** The value as a string-keyed record when it is a plain (non-array) object. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) && !Array.isArray(value) ? value : undefined;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The Node errno code (`ENOENT`, `EPERM`, ...) a caught error carries, if any. */
export function errnoCode(error: unknown): string | undefined {
	if (!(error instanceof Error) || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

/** `Object.keys` typed to the object's own keys, for literal lookup tables whose keys are exactly their type's keys. */
export function objectKeys<T extends object>(object: T): Array<keyof T & string> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys returns string[]; callers pass closed literal tables
	return Object.keys(object) as Array<keyof T & string>;
}

/** Whether `key` is an own key of `object`, narrowing it for a typed lookup. */
export function isKeyOf<T extends object>(object: T, key: PropertyKey): key is keyof T {
	return Object.hasOwn(object, key);
}
