import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { ApprovalsResponse } from "../../lib/api/approvals";

export const Route = createFileRoute("/api/approvals")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const { getPendingApprovals, getPendingApprovalsForProject, revalidatePendingApprovals } =
          await import("../../lib/db/pending-approvals-cache");
        const { getDb } = await import("../../lib/db");
        // Heal entries the watcher never got an event for before serving them.
        await revalidatePendingApprovals(getDb().index);
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId");
        const approvals = projectId
          ? getPendingApprovalsForProject(projectId)
          : getPendingApprovals();
        return Response.json(ApprovalsResponse.parse({ approvals }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
