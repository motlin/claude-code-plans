import { SessionStatusFilterSchema, type SessionStatusFilter } from "../session-groups";

/**
 * The `?status=` archive filter on session list endpoints: absent means
 * "active" (archived sessions hidden); an unknown value is null so the route
 * can answer 400 rather than silently widen or narrow the list.
 */
export function parseSessionStatusParam(url: URL): SessionStatusFilter | null {
  const raw = url.searchParams.get("status");
  if (raw === null) return "active";
  const parsed = SessionStatusFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function invalidSessionStatusResponse(): Response {
  return Response.json({ error: "Invalid status" }, { status: 400 });
}
