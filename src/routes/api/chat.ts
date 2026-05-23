import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handleCancel, spawnResumeStream } from "../../lib/spawn-resume";

const chatSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const json: unknown = await request.json();

        const cancelled = handleCancel(json);
        if (cancelled) return cancelled;

        const chatResult = chatSchema.safeParse(json);
        if (!chatResult.success) {
          return Response.json({ error: "sessionId and prompt are required" }, { status: 400 });
        }

        return spawnResumeStream(chatResult.data);
      },
    },
  },
});
