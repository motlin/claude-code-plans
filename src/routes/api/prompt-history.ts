import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { PromptHistoryResponse } from "../../lib/api/prompt-history";

export const Route = createFileRoute("/api/prompt-history")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim() || undefined;
        const { readPromptHistory } = await import("../../lib/prompt-history.server");
        return Response.json(PromptHistoryResponse.parse(await readPromptHistory({ sessionId })), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
