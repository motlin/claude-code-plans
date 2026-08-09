import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { SESSION_ID_PATTERN, StatuslineResponse } from "../../lib/api/statusline";

interface SessionStatuslineDependencies {
  readStatusline(sessionId: string): Promise<unknown>;
}

export async function handleSessionStatuslineRequest(
  sessionId: string,
  dependencies: SessionStatuslineDependencies,
): Promise<Response> {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return Response.json(StatuslineResponse.parse(null), {
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  }

  try {
    return Response.json(StatuslineResponse.parse(await dependencies.readStatusline(sessionId)), {
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  } catch {
    return Response.json(StatuslineResponse.parse(null), {
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  }
}

export const Route = createFileRoute("/api/sessions/$id/statusline")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { join } = await import("node:path");
        const { getCacheDir } = await import("../../lib/db/connection");
        return handleSessionStatuslineRequest(params.id, {
          readStatusline: async (sessionId) => {
            const filePath = join(getCacheDir(), "statusline", `${sessionId}.json`);
            const { readFile } = await import("node:fs/promises");
            const raw = await readFile(filePath, "utf-8");
            return JSON.parse(raw) as unknown;
          },
        });
      },
    }),
  },
});
