/** Treats a missing or empty string as absent, so callers can fall back with `??`. */
export function nonEmpty(value: string | null | undefined): string | undefined {
	return value === undefined || value === null || value === "" ? undefined : value;
}
