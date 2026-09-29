import { readFile, unlink, writeFile } from "node:fs/promises";
import type { TurnUndoFile } from "./api/turn-undo";
import type { JsonlRecord } from "./schemas";
import { aggregateSessionEdits, findTurnUuids, type SessionEditFile } from "./session-edits-diff";

export type TurnUndoPreview = { kind: "not-found" } | { kind: "ok"; files: TurnUndoFile[] };

export type TurnUndoResult =
  | { kind: "not-found" }
  | { kind: "confirm-required" }
  | { kind: "blocked"; files: TurnUndoFile[] }
  | { kind: "reverted"; files: string[] };

interface PlannedFile {
  edit: SessionEditFile;
  file: TurnUndoFile;
}

async function readCurrent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function plan(records: readonly JsonlRecord[], turnUuid: string) {
  const uuids = findTurnUuids(records, turnUuid);
  if (uuids === null) return null;
  const edits = aggregateSessionEdits(records, { turnUuids: uuids });
  return Promise.all(
    edits.map(async (edit): Promise<PlannedFile> => {
      let state: TurnUndoFile["state"] = "unknown";
      if (edit.complete && edit.newContent !== null) {
        state = (await readCurrent(edit.path)) === edit.newContent ? "ready" : "conflict";
      }
      return { edit, file: { path: edit.path, status: edit.status, state } };
    }),
  );
}

/** The turn's net file edits, each checked against what is on disk now. */
export async function previewTurnUndo(
  records: readonly JsonlRecord[],
  turnUuid: string,
): Promise<TurnUndoPreview> {
  const planned = await plan(records, turnUuid);
  if (planned === null) return { kind: "not-found" };
  return { kind: "ok", files: planned.map(({ file }) => file) };
}

/**
 * Revert a turn's edits from the transcript's before snapshots: modified
 * files get their original content back and files the turn created are
 * deleted. Refuses (writing nothing) unless confirmed and every file still
 * holds exactly the turn's result.
 */
export async function undoTurn(
  records: readonly JsonlRecord[],
  turnUuid: string,
  { confirm }: { confirm: boolean },
): Promise<TurnUndoResult> {
  const planned = await plan(records, turnUuid);
  if (planned === null) return { kind: "not-found" };
  if (!confirm) return { kind: "confirm-required" };
  if (planned.some(({ file }) => file.state !== "ready")) {
    return { kind: "blocked", files: planned.map(({ file }) => file) };
  }
  for (const { edit } of planned) {
    if (edit.oldContent === null) await unlink(edit.path);
    else await writeFile(edit.path, edit.oldContent, "utf8");
  }
  return { kind: "reverted", files: planned.map(({ edit }) => edit.path) };
}
