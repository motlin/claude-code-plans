type ApiHandler = (context: never) => Response | Promise<Response>;

/**
 * Wraps a server route's handlers with an ANY fallback that answers 405
 * Method Not Allowed (with an Allow header listing the declared methods)
 * instead of letting unmatched methods fall through to the SPA HTML shell.
 */
export function withMethodNotAllowed<T extends Record<string, ApiHandler>>(
  handlers: T,
): T & { ANY: () => Response } {
  const allow = Object.keys(handlers).sort().join(", ");
  return {
    ...handlers,
    ANY: () =>
      Response.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: allow } }),
  };
}
