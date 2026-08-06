import { createFileRoute } from "@tanstack/react-router";
import { StatuslineResponse } from "../../lib/api/statusline";

export const Route = createFileRoute("/api/sessions/$id/statusline")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { join } = await import("node:path");
        const { getCacheDir } = await import("../../lib/db/connection");
        const filePath = join(getCacheDir(), "statusline", `${params.id}.json`);

        try {
          const { readFile } = await import("node:fs/promises");
          const raw = await readFile(filePath, "utf-8");
          const parsed = JSON.parse(raw) as unknown;
          return Response.json(StatuslineResponse.parse(parsed), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        } catch {
          return Response.json(StatuslineResponse.parse(null), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }
      },
    },
  },
});
