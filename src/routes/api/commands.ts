import { createFileRoute } from "@tanstack/react-router";
import { SlashCommandListResponse } from "../../lib/api/commands";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/commands")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const cwd = new URL(request.url).searchParams.get("cwd")?.trim() || undefined;
        if (cwd !== undefined && !cwd.startsWith("/")) {
          return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
        }
        const { listSlashCommands } = await import("../../lib/slash-commands.server");
        return Response.json(SlashCommandListResponse.parse(await listSlashCommands({ cwd })), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
