import { createFileRoute } from "@tanstack/react-router";
import { HomeDismissBodySchema, HomeDismissalsResponse } from "../../lib/api/home-dismissals";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";

const NO_STORE = { "Cache-Control": "private, max-age=0, must-revalidate" };

async function listDismissals(): Promise<Response> {
  const { getDb } = await import("../../lib/db");
  const { getHomeDismissals } = await import("../../lib/db/home-dismissals");
  return Response.json(
    HomeDismissalsResponse.parse({ dismissals: getHomeDismissals(getDb().index) }),
    { headers: NO_STORE },
  );
}

export const Route = createFileRoute("/api/home/dismissals")({
  server: {
    handlers: withMethodNotAllowed({
      GET: listDismissals,
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const body = HomeDismissBodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) {
          return Response.json({ error: "Expected { sessionId }" }, { status: 400 });
        }

        const { getDb } = await import("../../lib/db");
        const { dismissHomeSession } = await import("../../lib/db/home-dismissals");
        dismissHomeSession(getDb().index, body.data.sessionId);
        return listDismissals();
      },
    }),
  },
});
