import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { UserCommandListResponse } from "../../lib/api/plugins";

export const Route = createFileRoute("/api/plugins/user-commands")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { listUserCommands } = await import("../../lib/plugins");
        const groups = await listUserCommands();
        return Response.json(UserCommandListResponse.parse(groups), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
