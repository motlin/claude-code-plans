import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { TranscriptResponse } from "../../lib/api/sessions";

/**
 * `?before=<index>` asks for the page of records ending just before that index
 * in the session's JSONL. Without it the endpoint serves the tail, which is the
 * only part of a long session the reader sees on first paint.
 */
function parseBefore(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const before = Number.parseInt(raw, 10);
  if (!Number.isFinite(before) || before < 0) return undefined;
  return before;
}

export const Route = createFileRoute("/api/sessions/$id/transcript")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const { getDb } = await import("../../lib/db");
        const { readStructuredTranscript } = await import("../../lib/structured-transcript");
        const { index } = getDb();
        const before = parseBefore(new URL(request.url).searchParams.get("before"));
        const transcript = readStructuredTranscript(index, params.id, { before });
        return Response.json(TranscriptResponse.parse(transcript), {
          headers: {
            "Cache-Control": "private, max-age=0, must-revalidate",
          },
        });
      },
    }),
  },
});
