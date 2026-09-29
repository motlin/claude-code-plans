import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";
import { buildSideChatPrompt, SideChatRequestSchema } from "../../lib/side-chat";
import { handleCancel, spawnResumeStream } from "../../lib/spawn-resume";

export const Route = createFileRoute("/api/side-chat")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const json: unknown = await request.json();

        const cancelled = handleCancel(json);
        if (cancelled) return cancelled;

        const result = SideChatRequestSchema.safeParse(json);
        if (!result.success) {
          return Response.json({ error: "sessionId and question are required" }, { status: 400 });
        }

        const { sessionId, messages, question } = result.data;
        return spawnResumeStream({
          sessionId,
          prompt: buildSideChatPrompt(messages, question),
          ephemeral: true,
        });
      },
    }),
  },
});
