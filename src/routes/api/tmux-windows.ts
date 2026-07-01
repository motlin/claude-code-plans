import { createFileRoute } from "@tanstack/react-router";
import { TmuxWindowListResponse } from "../../lib/api/tmux";

export const Route = createFileRoute("/api/tmux-windows")({
  server: {
    handlers: {
      GET: async () => {
        const { getTmuxWindows } = await import("../../lib/tmux-windows");
        const windows = await getTmuxWindows();
        return Response.json(TmuxWindowListResponse.parse(windows), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
