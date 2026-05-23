import { createFileRoute } from "@tanstack/react-router";
import { UserCommandListResponse } from "../../lib/api/plugins";

export const Route = createFileRoute("/api/plugins/user-commands")({
  server: {
    handlers: {
      GET: async () => {
        const { listUserCommands } = await import("../../lib/plugins");
        const groups = await listUserCommands();
        return Response.json(UserCommandListResponse.parse(groups), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
