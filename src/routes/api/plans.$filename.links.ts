import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { PlanLinksResponse } from "../../lib/api/plans";
import { fromMdSlug } from "../../lib/md-slug";

export const Route = createFileRoute("/api/plans/$filename/links")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { filename: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { getPlanLinksFromDb } = await import("../../lib/db/queries");

        const { index } = getDb();
        const links = getPlanLinksFromDb(index, fromMdSlug(params.filename));
        const serialized = links.map((l) => ({
          sessionId: l.sessionId,
          project: l.projectId,
          projectName: l.projectName,
          sessionTitle: l.sessionTitle,
        }));

        return Response.json(PlanLinksResponse.parse(serialized), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
