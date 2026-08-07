import { createFileRoute } from "@tanstack/react-router";
import {
  SESSION_ID_PATTERN,
  SessionMetricsBatchResponse,
  StatuslineSchema,
  toSessionMetrics,
} from "../../lib/api/statusline";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

interface StatuslineBatchDependencies {
  readStatusline(sessionId: string): Promise<unknown>;
}

export async function handleStatuslineBatchRequest(
  request: Request,
  dependencies: StatuslineBatchDependencies,
): Promise<Response> {
  const sessionIds = [
    ...new Set(
      (new URL(request.url).searchParams.get("ids") ?? "")
        .split(",")
        .map((sessionId) => sessionId.trim())
        .filter((sessionId) => SESSION_ID_PATTERN.test(sessionId)),
    ),
  ];

  const metrics = Object.fromEntries(
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          const statusline = StatuslineSchema.parse(await dependencies.readStatusline(sessionId));
          return [sessionId, toSessionMetrics(statusline)] as const;
        } catch {
          return [sessionId, null] as const;
        }
      }),
    ),
  );

  return Response.json(SessionMetricsBatchResponse.parse(metrics), {
    headers: { "Cache-Control": PRIVATE_NO_CACHE },
  });
}

export const Route = createFileRoute("/api/sessions/statusline")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const [{ readFile }, { join }, { getCacheDir }] = await Promise.all([
          import("node:fs/promises"),
          import("node:path"),
          import("../../lib/db/connection"),
        ]);
        const statuslineDirectory = join(getCacheDir(), "statusline");

        return handleStatuslineBatchRequest(request, {
          readStatusline: async (sessionId) => {
            const raw = await readFile(join(statuslineDirectory, `${sessionId}.json`), "utf-8");
            return JSON.parse(raw) as unknown;
          },
        });
      },
    },
  },
});
