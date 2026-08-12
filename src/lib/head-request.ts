/**
 * A HEAD response carries no body, so the platform hands our streaming body
 * straight to the garbage collector without ever reading or cancelling it.
 * Nothing then runs the stream's teardown:
 *
 * - Document routes: TanStack's SSR transform stream only cleans up from
 *   `pull()` or `cancel()`, so an unread HEAD body sits open until its 120s
 *   lifetime timer fires and logs "SSR stream transform exceeded maximum
 *   lifetime (120000ms), forcing cleanup".
 * - `/api/events`: HEAD falls back to the GET handler, which registers an SSE
 *   client and a 30s keepalive interval that are only released by the stream's
 *   `cancel()` — so an unread HEAD body leaks both forever.
 *
 * Both are reached by ordinary probes: `scripts/server.sh` polls with
 * `curl -sI` on startup.
 *
 * Cancelling the body ourselves runs each stream's teardown immediately while
 * preserving HEAD's contract of GET's status and headers with no body.
 */
export function withHeadBodyCancel(
  fetchImpl: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await fetchImpl(request);
    if (request.method !== "HEAD" || response.body === null) return response;

    try {
      await response.body.cancel();
    } catch {
      // A body whose cancel() rejects is already unusable; the HEAD response
      // still owes the client only headers.
    }

    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
