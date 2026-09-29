import { z } from "zod";
import { ApiResponseError, apiFetch, resolveUrl } from "./client";

/**
 * `ready`: the file still holds the turn's result and can be reverted.
 * `conflict`: it changed (or vanished) since the turn.
 * `unknown`: the transcript has no before snapshot to restore.
 */
const TurnUndoFileSchema = z
  .object({
    path: z.string(),
    status: z.enum(["added", "modified"]),
    state: z.enum(["ready", "conflict", "unknown"]),
  })
  .strict();

export type TurnUndoFile = z.infer<typeof TurnUndoFileSchema>;

export const TurnUndoPreviewResponseSchema = z
  .object({ files: z.array(TurnUndoFileSchema) })
  .strict();

export const TurnUndoRevertedResponseSchema = z.object({ reverted: z.array(z.string()) }).strict();

export const TurnUndoBlockedResponseSchema = z
  .object({ error: z.string(), files: z.array(TurnUndoFileSchema) })
  .strict();

function turnUndoUrl(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/turn-undo`;
}

export function fetchTurnUndoPreview(sessionId: string, turnUuid: string) {
  return apiFetch(
    `${turnUndoUrl(sessionId)}?turn=${encodeURIComponent(turnUuid)}`,
    TurnUndoPreviewResponseSchema,
    { cache: "no-store" },
  );
}

export type TurnUndoOutcome =
  | { kind: "reverted"; files: string[] }
  | { kind: "blocked"; files: TurnUndoFile[] };

/** Reverts the turn; resolves to `blocked` when the server found files changed since it. */
export async function postTurnUndo(sessionId: string, turnUuid: string): Promise<TurnUndoOutcome> {
  const url = turnUndoUrl(sessionId);
  const response = await fetch(resolveUrl(url), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turn: turnUuid, confirm: true }),
  });
  if (response.status === 409) {
    const body = TurnUndoBlockedResponseSchema.parse(await response.json());
    return { kind: "blocked", files: body.files };
  }
  if (!response.ok) throw new ApiResponseError(url, response);
  const body = TurnUndoRevertedResponseSchema.parse(await response.json());
  return { kind: "reverted", files: body.reverted };
}
