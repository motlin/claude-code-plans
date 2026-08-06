import { createFileRoute } from "@tanstack/react-router";
import { TranscriptResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/$id/transcript")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { readStructuredTranscript } = await import("../../lib/structured-transcript");
        const { index } = getDb();
        const transcript = readStructuredTranscript(index, params.id);
        return Response.json(TranscriptResponse.parse(transcript), {
          headers: {
            "Cache-Control": "private, max-age=0, must-revalidate",
          },
        });
      },
    },
  },
});
