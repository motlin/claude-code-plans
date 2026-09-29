import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/attachments")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { handleAttachmentUpload } = await import("../../lib/attachments.server");
        return handleAttachmentUpload(request);
      },
    }),
  },
});
