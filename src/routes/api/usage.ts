import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export async function handleUsageRequest(statuslineDirectory: string): Promise<Response> {
  const { readLatestUsage } = await import("../../lib/usage-reader");
  return Response.json(await readLatestUsage(statuslineDirectory), {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

export const Route = createFileRoute("/api/usage")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const [{ join }, { getCacheDir }] = await Promise.all([
          import("node:path"),
          import("../../lib/db/connection"),
        ]);
        return handleUsageRequest(join(getCacheDir(), "statusline"));
      },
    }),
  },
});
