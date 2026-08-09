import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { z } from "zod";
import { rejectCrossSite } from "../../lib/same-origin-guard";
import { handleCancel, spawnResumeStream } from "../../lib/spawn-resume";

const chatSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const json: unknown = await request.json();

        const cancelled = handleCancel(json);
        if (cancelled) return cancelled;

        const chatResult = chatSchema.safeParse(json);
        if (!chatResult.success) {
          return Response.json({ error: "sessionId and prompt are required" }, { status: 400 });
        }

        return spawnResumeStream(chatResult.data);
      },
    }),
  },
});
