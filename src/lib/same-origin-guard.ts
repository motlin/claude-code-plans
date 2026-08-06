export function rejectCrossSite(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (
    (origin !== null && origin !== new URL(request.url).origin) ||
    (secFetchSite !== null && secFetchSite !== "same-origin")
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  return null;
}
