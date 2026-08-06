function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first ? first : null;
}

function originMatchesRequest(request: Request, origin: string): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  if (originUrl.origin !== origin) return false;
  if (originUrl.origin === new URL(request.url).origin) return true;

  const publicHosts = [
    firstHeaderValue(request.headers.get("X-Forwarded-Host")),
    firstHeaderValue(request.headers.get("Host")),
  ];
  return publicHosts.some((host) => host?.toLowerCase() === originUrl.host.toLowerCase());
}

export function rejectCrossSite(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (
    (origin !== null && !originMatchesRequest(request, origin)) ||
    (secFetchSite !== null && secFetchSite !== "same-origin")
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
