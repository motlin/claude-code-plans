import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { StarredMutationResponse } from "../../lib/api/sessions";
import { rejectCrossSite } from "../../lib/same-origin-guard";

const StarredBody = z.object({ starred: z.boolean() });

export const Route = createFileRoute("/api/sessions/$id/starred")({
  server: {
    handlers: {
      PUT: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { getDb } = await import("../../lib/db");
        const { setStar } = await import("../../lib/db/queries");
        const body = StarredBody.parse(await request.json());
        const { index } = getDb();
        const starred = setStar(index, params.id, body.starred);
        return Response.json(StarredMutationResponse.parse({ starred }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
