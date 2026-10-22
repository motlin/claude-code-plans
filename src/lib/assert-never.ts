/**
 * Compile-time exhaustiveness guard. Call in the default/fall-through branch
 * of a switch or if-chain over a discriminated union: when a new variant is
 * added to the union, the argument no longer narrows to `never` and
 * `tsgo --noEmit` fails at the call site, forcing the handler to be extended.
 *
 * At runtime it warns and hands the value back instead of throwing: the
 * lenient runtime schemas (`runtime-schemas.ts`) pass an enum value written by
 * a newer Claude Code through, and that must not crash the page.
 */
export function assertNever(value: never): never {
	console.warn(`Unhandled case: ${JSON.stringify(value)}`);
	return value;
}
