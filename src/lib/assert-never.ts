/**
 * Compile-time exhaustiveness guard. Call in the default/fall-through branch
 * of a switch or if-chain over a discriminated union: when a new variant is
 * added to the union, the argument no longer narrows to `never` and
 * `tsgo --noEmit` fails at the call site, forcing the handler to be extended.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
