import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";

type HandlerContext = { params: { id: string }; request: Request };

async function handle({ params, request }: HandlerContext) {
  const { handleTurnUndoRequest } = await import("../../lib/turn-undo-handler");
  return handleTurnUndoRequest(params.id, request);
}

/** Preview (GET) and revert (POST) one turn's file edits for the turn changes card's Undo. */
export const Route = createFileRoute("/api/sessions/$id/turn-undo")({
  server: {
    handlers: withMethodNotAllowed({
      GET: handle,
      POST: async (context: HandlerContext) => rejectCrossSite(context.request) ?? handle(context),
    }),
  },
});
