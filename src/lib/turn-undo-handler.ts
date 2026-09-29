import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import {
  TurnUndoBlockedResponseSchema,
  TurnUndoPreviewResponseSchema,
  TurnUndoRevertedResponseSchema,
} from "./api/turn-undo";
import { getDb } from "./db";
import type * as schema from "./db/schema";
import type { JsonlRecord } from "./schemas";
import { errorResponse, findSession, jsonResponse, readRecords } from "./session-diff-handler";
import { previewTurnUndo, undoTurn } from "./turn-undo";

export interface TurnUndoHandlerDependencies {
  index: BetterSQLite3Database<typeof schema>;
  readRecords(filePath: string): Promise<JsonlRecord[]>;
}

const UndoRequestSchema = z
  .object({ turn: z.string().min(1), confirm: z.boolean().optional() })
  .strict();

async function parseBody(request: Request): Promise<z.infer<typeof UndoRequestSchema> | null> {
  try {
    const parsed = UndoRequestSchema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * `GET /api/sessions/$id/turn-undo?turn=<uuid>` previews the turn's files;
 * `POST {turn, confirm: true}` reverts them (409 when any changed since).
 */
export async function handleTurnUndoRequest(
  sessionId: string,
  request: Request,
  dependencies?: TurnUndoHandlerDependencies,
): Promise<Response> {
  const resolved = dependencies ?? { index: getDb().index, readRecords };
  const session = findSession(resolved.index, sessionId);
  if ("error" in session) return session.error;

  if (request.method === "GET") {
    const turn = new URL(request.url).searchParams.get("turn");
    if (!turn) return errorResponse("A turn is required", 400);
    const records = await resolved.readRecords(session.location.filePath);
    const preview = await previewTurnUndo(records, turn);
    if (preview.kind === "not-found") return errorResponse("Turn not found", 404);
    return jsonResponse(TurnUndoPreviewResponseSchema.parse({ files: preview.files }));
  }

  const body = await parseBody(request);
  if (body === null) return errorResponse("Invalid request body", 400);
  const records = await resolved.readRecords(session.location.filePath);
  const result = await undoTurn(records, body.turn, { confirm: body.confirm === true });
  switch (result.kind) {
    case "not-found":
      return errorResponse("Turn not found", 404);
    case "confirm-required":
      return errorResponse("Confirmation required", 400);
    case "blocked":
      return jsonResponse(
        TurnUndoBlockedResponseSchema.parse({
          error: "Files changed since this turn",
          files: result.files,
        }),
        409,
      );
    case "reverted":
      return jsonResponse(TurnUndoRevertedResponseSchema.parse({ reverted: result.files }));
  }
}
